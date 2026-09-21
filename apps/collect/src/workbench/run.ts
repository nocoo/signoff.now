import { adoPullId, type CollectorClaim } from "@signoff/domain/collection";
import { advanceDemoPull, makeDemoPulls } from "@signoff/domain/demo";
import { matchesRepositoryReference } from "@signoff/domain/monitoring";
import type { CollectionLane, PullRequest } from "@signoff/domain/workbench";
import { AdoError, type AdoPagedClient } from "../ado/client.ts";
import type { Logger } from "../logger.ts";
import { isPipelineClientError } from "../pipeline/client.ts";
import {
	collectProjectPulls,
	discoverRepositories,
	discoverRepositoryPulls,
} from "./ado.ts";
import type { CollectionClient } from "./client.ts";

type FailureKind = Parameters<CollectionClient["fail"]>[1];
export function collectionError(error: unknown): {
	kind: FailureKind;
	message: string;
} {
	if (error instanceof AdoError)
		return {
			kind:
				error.kind === "unauthenticated"
					? "auth_required"
					: error.kind === "forbidden" || error.kind === "not_found"
						? error.kind
						: error.kind === "server" || error.kind === "rate_limited"
							? "unavailable"
							: "invalid_data",
			message: error.message,
		};
	if (isPipelineClientError(error)) {
		const body = error.body as { error?: string | { message?: string } } | null;
		return {
			kind: "unavailable",
			message:
				typeof body?.error === "string"
					? body.error
					: (body?.error?.message ?? error.message),
		};
	}
	return {
		kind: "invalid_data",
		message: error instanceof Error ? error.message : "Collection failed",
	};
}

type RunOptions = {
	api: CollectionClient;
	/** Lazily constructed only after a real provider task has been claimed. */
	makeAdo: () => AdoPagedClient;
	log: Logger;
	keepAliveMs?: number;
	jobId?: string;
	lane?: CollectionLane;
	collect?: typeof collectProjectPulls;
	signal?: AbortSignal;
};

async function sampleTask(
	api: CollectionClient,
	claim: CollectorClaim,
	timestamp: number,
) {
	let pulls: PullRequest[];
	if (claim.job.kind === "details") {
		if (!claim.targets?.[0]) throw new Error("Sample PR is not in the cache");
		const advanced = advanceDemoPull(
			claim.targets[0],
			timestamp,
			claim.job.id,
		).pull;
		pulls = [
			{
				...advanced,
				observedAt: timestamp,
				summaryObservedAt: timestamp,
				checksObservedAt: timestamp,
			},
		];
	} else {
		const cached = (await api.load()).pullRequests.filter(
			(p) => p.projectId === claim.project.id,
		);
		pulls = cached.length ? cached : makeDemoPulls(claim.project, timestamp);
		const repositoryIds = pulls.map((pull) => pull.repository.id);
		pulls = pulls.filter(
			(p) =>
				!claim.scope?.length ||
				claim.scope.some((s) =>
					matchesRepositoryReference(
						p.repository,
						s,
						claim.project.provider,
						repositoryIds,
					),
				),
		);
	}
	const repos = [
		...new Map(pulls.map((p) => [p.repository.id, p.repository])).values(),
	];
	await api.repositories(claim, repos);
	for (const repo of repos) {
		const selected = pulls.filter((p) => p.repository.id === repo.id);
		await api.upload(claim, selected);
		const result = await api.publish(
			claim,
			repo.id,
			claim.job.kind === "details" &&
				selected.some((p) => p.coverage === "partial")
				? "partial"
				: "complete",
			selected.length,
			"Sample data updated",
		);
		if (claim.job.kind === "details") return result;
	}
	return api.complete(claim);
}

/** Executor only consumes saved tasks. No provider setup or login checks on an idle claim. */
export async function runCollectionOnce(opts: RunOptions): Promise<{
	processed: boolean;
	state:
		| "idle"
		| "complete"
		| "partial"
		| "failed"
		| "auth_required"
		| "canceled";
}> {
	const { api, log } = opts;
	const claim = await api.claim(undefined, opts.jobId, opts.lane);
	if (!claim) return { processed: false, state: "idle" };
	let ado: AdoPagedClient | undefined;
	let done = 0;
	let total: number | null = null;
	let phase: import("@signoff/domain/collection").CollectionPhase = "starting";
	let phaseMessage = "Starting collection";
	let progressError: unknown;
	let reporting = Promise.resolve();
	let publishing = false;
	const check = () => {
		if (progressError) throw progressError;
		opts.signal?.throwIfAborted();
	};
	const report = () => {
		reporting = reporting
			.then(async () => {
				if (publishing) return;
				await api.progress(claim, done, total, phaseMessage, phase);
				await api.heartbeat("ready", "Refreshing the shared PR watch list");
			})
			.catch((error: unknown) => {
				progressError ??= error;
			});
		return reporting;
	};
	const setPhase = async (
		next: import("@signoff/domain/collection").CollectionPhase,
		message: string,
	) => {
		phase = next;
		phaseMessage = message;
		await report();
		check();
	};
	const timer = setInterval(() => {
		void report();
	}, opts.keepAliveMs ?? 20_000);
	try {
		const timestamp = Math.floor(Date.now() / 1000);
		if (claim.project.source === "demo") {
			clearInterval(timer);
			await reporting;
			check();
			const result = await sampleTask(api, claim, timestamp);
			return { processed: true, state: result.state as "complete" | "partial" };
		}
		const provider = opts.makeAdo();
		const guarded =
			<A extends unknown[], T>(operation: (...args: A) => Promise<T>) =>
			async (...args: A): Promise<T> => {
				await reporting;
				check();
				const value = await operation(...args);
				await reporting;
				check();
				return value;
			};
		ado = {
			get: guarded(provider.get.bind(provider)),
			getPage: guarded(provider.getPage.bind(provider)),
			post: guarded(provider.post.bind(provider)),
			checkAuth: guarded(provider.checkAuth.bind(provider)),
			invalidateToken: provider.invalidateToken.bind(provider),
		};
		await setPhase("authenticating", "Checking provider credentials");
		await ado.checkAuth(claim.project.organization);
		check();
		log.info(
			`${claim.job.kind === "list" ? "Discovering" : "Refreshing watched PR in"} ${claim.project.organization}/${claim.project.projectKey}`,
		);
		if (claim.job.kind === "list") {
			await setPhase("repositories", "Resolving project repositories");
			const repos =
				claim.repositories?.map((repo) => ({
					id: repo.id,
					name: repo.name,
					projectGuid: repo.projectExternalId ?? claim.project.projectKey,
					observedAt: 0,
				})) ??
				(await discoverRepositories(ado, {
					...claim.project,
					repositories: claim.scope ?? claim.project.repositories,
				}));
			check();
			const planned = await api.repositories(
				claim,
				repos.map((r) => ({
					id: r.id,
					name: r.name,
					projectExternalId: r.projectGuid,
					observedAt: r.observedAt,
				})),
			);
			for (const repo of repos) {
				const repositoryPlan = planned.find((r) => r.repository_id === repo.id);
				if (["succeeded", "failed"].includes(repositoryPlan?.state ?? ""))
					continue;
				let count = 0;
				try {
					await setPhase("listing", `Refreshing ${repo.name} PR list`);
					for await (const pulls of discoverRepositoryPulls(
						ado,
						claim.project,
						repo,
						Date.now() / 1000,
					)) {
						check();
						await api.upload(claim, pulls);
						count += pulls.length;
						done += pulls.length;
						await report();
						check();
					}
					await reporting;
					check();
					await setPhase("publishing", `Saving ${repo.name}: ${count} PRs`);
					await api.publish(
						claim,
						repo.id,
						"complete",
						count,
						`Refreshed ${count} PR states from the repository list`,
					);
				} catch (error) {
					if (
						progressError ||
						opts.signal?.aborted ||
						isPipelineClientError(error) ||
						(error instanceof AdoError && error.kind === "unauthenticated")
					)
						throw error;
					await api.repositoryFail(
						claim,
						repo.id,
						collectionError(error).message,
					);
				}
			}
			clearInterval(timer);
			await reporting;
			check();
			publishing = true;
			const result = await api.complete(claim);
			return {
				processed: true,
				state: result.state as "complete" | "partial" | "failed",
			};
		}
		const ref = claim.observation?.ref;
		if (!ref) throw new Error("Refresh task has no observation identity");
		await api.repositories(claim, [ref.repository]);
		const result = await (opts.collect ?? collectProjectPulls)({
			project: claim.project,
			client: ado,
			onPhase: setPhase,
			now: Date.now() / 1000,
			targets: [
				{
					id:
						claim.observation?.pullId ??
						adoPullId(ref.projectId, ref.repository.id, String(ref.number)),
					number: ref.number,
					repository: ref.repository,
				},
			],
			onProgress: async (completed, count) => {
				done = Math.max(done, completed);
				total = count;
				await report();
				check();
			},
		});
		check();
		await setPhase("publishing", "Saving complete PR collection");
		await api.upload(claim, result.pulls);
		clearInterval(timer);
		await reporting;
		check();
		publishing = true;
		const published = await api.publish(
			claim,
			ref.repository.id,
			result.state,
			result.pulls.length,
			result.message,
			result.mergeRequirements,
		);
		return {
			processed: true,
			state: published.state as "complete" | "partial",
		};
	} catch (error) {
		clearInterval(timer);
		await reporting;
		const failure = collectionError(error);
		if (failure.kind === "auth_required") ado?.invalidateToken();
		try {
			await api.fail(claim, failure.kind, failure.message);
		} catch {
			log.warn("Task lease changed; retained snapshots remain available.");
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

export async function watchCollections(
	opts: RunOptions & { sleep?: (ms: number) => Promise<unknown> },
): Promise<void> {
	const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
	await Promise.all(
		(["checks", "checks", "discover"] as const).map(async (lane) => {
			while (!opts.signal?.aborted) {
				try {
					await opts.api.heartbeat("ready", "Watching the shared PR list");
					await opts.api.schedule(
						lane === "discover" ? "list" : "details",
						lane,
					);
					if (opts.signal?.aborted) break;
					const result = await runCollectionOnce({ ...opts, lane });
					if (
						!opts.signal?.aborted &&
						(!result.processed || result.state === "auth_required")
					)
						await sleep(3000);
				} catch (error) {
					opts.log.error(collectionError(error).message);
					if (!opts.signal?.aborted) await sleep(10_000);
				}
			}
		}),
	);
}
