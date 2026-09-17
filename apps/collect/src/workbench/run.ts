import { parseAdoRepositoryUrl } from "@signoff/domain/collection";
import type { Project, PullRequest } from "@signoff/domain/workbench";
import { AdoError, type AdoPagedClient } from "../ado/client.ts";
import type { Logger } from "../logger.ts";
import { isPipelineClientError } from "../pipeline/client.ts";
import type { CollectionClient } from "./client.ts";

type FailureKind = Parameters<CollectionClient["fail"]>[1];
export function collectionError(error: unknown): {
	kind: FailureKind;
	message: string;
} {
	if (error instanceof AdoError) {
		const kind =
			error.kind === "unauthenticated"
				? "auth_required"
				: error.kind === "forbidden" || error.kind === "not_found"
					? error.kind
					: error.kind === "server" || error.kind === "rate_limited"
						? "unavailable"
						: "invalid_data";
		return { kind, message: error.message };
	}
	if (isPipelineClientError(error)) {
		const body = error.body;
		return {
			kind: "unavailable",
			message:
				typeof body === "object" &&
				body !== null &&
				"error" in body &&
				typeof body.error === "string"
					? body.error
					: error.message,
		};
	}
	return {
		kind: "invalid_data",
		message: error instanceof Error ? error.message : "Collection failed",
	};
}

type Collect = (opts: {
	project: Project;
	client: AdoPagedClient;
	now: number;
	onProgress?: (done: number, total: number) => Promise<void>;
}) => Promise<{
	pulls: PullRequest[];
	state: "complete" | "partial";
	message: string;
}>;
type RunResult = {
	processed: boolean;
	state: "idle" | "complete" | "partial" | "failed" | "auth_required";
};

export async function runCollectionOnce(opts: {
	api: CollectionClient;
	ado: AdoPagedClient;
	collect: Collect;
	log: Logger;
	keepAliveMs?: number;
}): Promise<RunResult> {
	const { api, ado, log } = opts;
	try {
		await ado.checkAuth();
	} catch (error) {
		const failure = collectionError(error);
		await api.heartbeat(
			failure.kind === "auth_required" ? "auth_required" : "error",
			failure.message,
		);
		log.error(failure.message);
		return {
			processed: false,
			state: failure.kind === "auth_required" ? "auth_required" : "failed",
		};
	}
	await api.heartbeat("ready", "Azure session verified");
	const claim = await api.claim();
	if (!claim) return { processed: false, state: "idle" };
	let done = 0;
	let total: number | null = null;
	let progressError: unknown;
	let reporting = Promise.resolve();
	const report = () => {
		reporting = reporting
			.then(async () => {
				await api.progress(
					claim,
					done,
					total,
					total === null
						? "Discovering repositories and pull requests"
						: `Collected ${done} of ${total} pull requests`,
				);
				await api.heartbeat("ready", `Collecting ${claim.project.name}`);
			})
			.catch((error: unknown) => {
				progressError ??= error;
			});
		return reporting;
	};
	const timer = setInterval(() => {
		void report();
	}, opts.keepAliveMs ?? 20_000);
	try {
		await ado.checkAuth(claim.project.organization);
		log.info(
			`Collecting ${claim.project.organization}/${claim.project.projectKey}`,
		);
		const collected = await opts.collect({
			project: claim.project,
			client: ado,
			now: Math.floor(Date.now() / 1000),
			onProgress: async (completed, count) => {
				done = Math.max(done, completed);
				total = count;
				await report();
				if (progressError) throw progressError;
			},
		});
		await api.upload(claim, collected.pulls);
		clearInterval(timer);
		await reporting;
		if (progressError) throw progressError;
		const scan = await api.complete(
			claim,
			collected.state,
			collected.pulls.length,
			collected.message.slice(0, 1000),
		);
		log.info(
			`${claim.project.name}: ${scan.pullRequestCount} real PRs · ${scan.state}. ${scan.message}`,
		);
		return {
			processed: true,
			state: scan.state === "failed" ? "failed" : scan.state,
		};
	} catch (error) {
		clearInterval(timer);
		await reporting;
		const failure = collectionError(error);
		if (failure.kind === "auth_required") {
			ado.invalidateToken();
			await api.heartbeat("auth_required", failure.message);
		}
		try {
			await api.fail(claim, failure.kind, failure.message);
		} catch {
			log.warn(
				"Could not record scan failure; the lease will expire and the previous snapshot remains available.",
			);
		}
		log.error(`${claim.project.name}: ${failure.message}`);
		return {
			processed: true,
			state: failure.kind === "auth_required" ? "auth_required" : "failed",
		};
	} finally {
		clearInterval(timer);
	}
}

export async function registerRepositories(
	api: CollectionClient,
	urls: string[],
): Promise<string[]> {
	const sources = urls.map(parseAdoRepositoryUrl);
	const ids = new Set<string>();
	for (const source of sources) {
		const data = await api.load();
		const current = data.projects.find(
			(p) =>
				p.provider === "ado" &&
				p.organization.toLowerCase() === source.organization.toLowerCase() &&
				p.projectKey.toLowerCase() === source.projectKey.toLowerCase(),
		);
		if (!current) {
			const added = await api.createProject({
				provider: "ado",
				name: source.projectKey.slice(0, 100),
				organization: source.organization,
				projectKey: source.projectKey,
				repositories: [source.repository],
				owner: "Project maintainers",
				description: "",
				enabled: true,
			});
			ids.add(added.id);
			continue;
		}
		if (current.source !== "cli")
			throw new Error(
				`${current.name} is a demo project; use a separate real project.`,
			);
		if (
			current.repositories?.length &&
			!current.repositories.some(
				(repo) => repo.toLowerCase() === source.repository.toLowerCase(),
			)
		) {
			await api.patchProject(current, {
				repositories: [...current.repositories, source.repository],
			});
		}
		ids.add(current.id);
	}
	return [...ids];
}

export async function queueDueProjects(
	api: CollectionClient,
	intervalSeconds: number,
	now = Math.floor(Date.now() / 1000),
	projectIds?: string[],
): Promise<number> {
	const data = await api.load();
	let queued = 0;
	for (const project of data.projects) {
		if (
			!project.enabled ||
			project.source !== "cli" ||
			(projectIds && !projectIds.includes(project.id))
		)
			continue;
		const jobs = (data.collectionJobs ?? []).filter(
			(job) => job.projectId === project.id,
		);
		if (
			jobs.some(
				(job) =>
					job.revision === project.revision &&
					["queued", "running", "auth_required"].includes(job.state),
			)
		)
			continue;
		const lastAttempt = Math.max(
			project.lastScannedAt ?? 0,
			...jobs.map((job) => job.completedAt ?? job.updatedAt),
		);
		if (now - lastAttempt < intervalSeconds) continue;
		await api.enqueue(project);
		queued++;
	}
	return queued;
}
