import {
	type KnownOpenPull,
	parseAdoRepositoryUrl,
} from "@signoff/domain/collection";
import type {
	MergeRequirement,
	Project,
	PullRequest,
	RefreshQueueKind,
} from "@signoff/domain/workbench";
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
	targets?: PullRequest[];
	knownOpenPulls?: KnownOpenPull[];
	onProgress?: (done: number, total: number) => Promise<void>;
}) => Promise<{
	pulls: PullRequest[];
	state: "complete" | "partial";
	message: string;
	mergeRequirements?: MergeRequirement[];
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
	kind?: RefreshQueueKind;
	jobId?: string;
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
	const claim = await api.claim(opts.kind, opts.jobId);
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
			targets: claim.targets,
			knownOpenPulls: claim.knownOpenPulls,
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
			collected.mergeRequirements,
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

/** Each lane waits for publication before asking the persistent scheduler for its next job. */
export async function watchCollections(
	opts: Omit<Parameters<typeof runCollectionOnce>[0], "kind"> & {
		signal?: AbortSignal;
		sleep?: (ms: number) => Promise<unknown>;
	},
): Promise<void> {
	const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
	await Promise.all(
		(["list", "details"] as const).map(async (kind) => {
			while (!opts.signal?.aborted) {
				try {
					await opts.api.schedule(kind);
					if (opts.signal?.aborted) break;
					const result = await runCollectionOnce({ ...opts, kind });
					if (opts.signal?.aborted) break;
					if (!result.processed || result.state === "auth_required")
						await sleep(result.state === "auth_required" ? 15_000 : 3000);
				} catch (error) {
					opts.log.error(`${kind}: ${collectionError(error).message}`);
					if (!opts.signal?.aborted) await sleep(10_000);
				}
			}
		}),
	);
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

/** Explicit sync owns full-scan requests, even when automatic page work is paused. */
export async function syncCollections(
	opts: Omit<Parameters<typeof runCollectionOnce>[0], "kind"> & {
		projectIds?: string[];
		sleep?: (ms: number) => Promise<unknown>;
	},
): Promise<boolean> {
	const { api, log } = opts;
	const data = await api.load();
	const pending = new Set<string>();
	for (const project of data.projects) {
		if (
			!project.enabled ||
			project.source !== "cli" ||
			project.provider !== "ado" ||
			(opts.projectIds && !opts.projectIds.includes(project.id))
		)
			continue;
		pending.add((await api.enqueue(project)).id);
	}
	log.info(`Queued ${pending.size} project(s) for real collection.`);
	const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
	while (pending.size) {
		// Another collector may hold our project lease; an idle claim is not a
		// completed sync. Unrelated queued work must not consume this invocation.
		const result = await runCollectionOnce({
			...opts,
			jobId: pending.values().next().value,
		});
		if (result.state === "failed" || result.state === "auth_required")
			return false;
		for (const id of pending) {
			const job = await api.job(id);
			if (job.state === "failed" || job.state === "auth_required") {
				log.error(job.message || `Sync job ${id} did not complete`);
				return false;
			}
			if (job.state === "complete" || job.state === "partial")
				pending.delete(id);
		}
		if (pending.size && !result.processed) await sleep(3000);
	}
	return true;
}
