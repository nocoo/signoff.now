import {
	type AvatarTask,
	avatarTaskSchema,
	type CachedAvatar,
} from "@signoff/domain/avatars";
import {
	type CollectedRepository,
	type CollectorClaim,
	collectorClaimSchema,
} from "@signoff/domain/collection";
import type { NetworkEvent } from "@signoff/domain/network";
import {
	type CollectionLane,
	type CollectorStatus,
	collectionJobSchema,
	type MergeRequirement,
	type Project,
	type ProjectWrite,
	type PullRequest,
	projectSchema,
	type RefreshQueueKind,
	refreshQueueSchema,
	workbenchSchema,
} from "@signoff/domain/workbench";
import { z } from "zod";
import {
	type FetchLike,
	isPipelineClientError,
	pipelineRequest,
} from "../pipeline/client.ts";

export function collectionApiBase(value = "http://127.0.0.1:37042"): string {
	const url = new URL(value);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"PR collection currently writes to the local Worker only. Use http://127.0.0.1:37042.",
		);
	}
	return url.origin;
}

/** Leave headroom under the Worker body limit, including multibyte descriptions. */
export function collectionChunks(pulls: PullRequest[]): PullRequest[][] {
	const chunks: PullRequest[][] = [];
	let chunk: PullRequest[] = [];
	let bytes = 128;
	for (const pull of pulls) {
		const size = new TextEncoder().encode(JSON.stringify(pull)).byteLength + 1;
		if (size + 128 > 512_000)
			throw new Error(
				`PR #${pull.number} snapshot is too large to upload safely`,
			);
		if (chunk.length === 20 || bytes + size > 512_000) {
			chunks.push(chunk);
			chunk = [];
			bytes = 128;
		}
		chunk.push(pull);
		bytes += size;
	}
	if (chunk.length) chunks.push(chunk);
	return chunks;
}

type Lease = Pick<CollectorClaim, "leaseToken"> & { job: { id: string } };

export function createCollectionClient(
	opts: { apiBase?: string; fetchImpl?: FetchLike } = {},
) {
	const config = {
		apiBase: collectionApiBase(opts.apiBase),
		fetchImpl: opts.fetchImpl ?? globalThis.fetch.bind(globalThis),
		timeoutMs: 30_000,
		redirect: "error" as const,
	};
	const request = async (
		method: string,
		path: string,
		body?: unknown,
		retrySafe = method === "GET",
	) => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await pipelineRequest(
					path === "/api/collector/network"
						? { ...config, timeoutMs: 2000 }
						: path === "/api/ai/tick"
							? { ...config, timeoutMs: 60_000 }
							: config,
					method,
					path,
					body,
				);
			} catch (error) {
				if (
					!retrySafe ||
					attempt >= 2 ||
					!isPipelineClientError(error) ||
					![500, 502, 503, 504].includes(error.status)
				)
					throw error;
				await Bun.sleep(250 * 2 ** attempt);
			}
		}
	};
	const jobRequest = (lease: Lease, action: string, body: object) =>
		request(
			"POST",
			`/api/collector/jobs/${encodeURIComponent(lease.job.id)}/${action}`,
			{ ...body, leaseToken: lease.leaseToken },
			["progress", "batch", "repositories"].includes(action),
		);
	return {
		claimAvatars: async () =>
			avatarTaskSchema
				.array()
				.parse(await request("POST", "/api/collector/avatars/claim")),
		publishAvatar: (task: AvatarTask, avatar: CachedAvatar) =>
			request("POST", "/api/collector/avatars/publish", {
				...task,
				contentType: avatar.contentType,
				base64: Buffer.from(avatar.bytes).toString("base64"),
			}),
		failAvatar: (task: AvatarTask) =>
			request("POST", "/api/collector/avatars/fail", task),
		tickAi: () => request("POST", "/api/ai/tick", { source: "cli" }),
		recordNetwork: (event: NetworkEvent) =>
			request("POST", "/api/collector/network", event, true),
		job: async (id: string) =>
			collectionJobSchema.parse(
				await request("GET", `/api/collector/jobs/${encodeURIComponent(id)}`),
			),
		load: async () =>
			workbenchSchema.parse(await request("GET", "/api/workbench")),
		createProject: async (body: ProjectWrite) =>
			projectSchema.parse(await request("POST", "/api/projects", body)),
		patchProject: async (project: Project, changes: Partial<ProjectWrite>) =>
			projectSchema.parse(
				await request(
					"PATCH",
					`/api/projects/${encodeURIComponent(project.id)}`,
					{ ...changes, revision: project.revision },
				),
			),
		enqueue: async (project: Project) =>
			collectionJobSchema.parse(
				await request(
					"POST",
					`/api/projects/${encodeURIComponent(project.id)}/scan`,
					{ revision: project.revision },
				),
			),
		heartbeat: (state: CollectorStatus["state"], message = "") =>
			request("POST", "/api/collector/heartbeat", { state, message }, true),
		schedule: async (kind: RefreshQueueKind, lane?: CollectionLane) =>
			refreshQueueSchema.parse(
				await request("POST", "/api/collector/schedule", {
					kind,
					...(lane ? { lane } : {}),
				}),
			),
		claim: async (
			kind?: RefreshQueueKind,
			jobId?: string,
			lane?: CollectionLane,
		) => {
			const query = new URLSearchParams();
			if (kind) query.set("kind", kind);
			if (jobId) query.set("jobId", jobId);
			if (lane) query.set("lane", lane);
			const raw = await request(
				"POST",
				`/api/collector/claim${query.size ? `?${query}` : ""}`,
			);
			return raw === null ? null : collectorClaimSchema.parse(raw);
		},
		progress: (
			lease: Lease,
			completedPulls: number,
			totalPulls: number | null,
			message: string,
			phase?: import("@signoff/domain/collection").CollectionPhase,
		) =>
			jobRequest(lease, "progress", {
				completedPulls,
				totalPulls,
				message,
				phase,
			}),
		upload: async (lease: Lease, pulls: PullRequest[]) => {
			for (const chunk of collectionChunks(pulls))
				await jobRequest(lease, "batch", { pulls: chunk });
		},
		repositories: async (lease: Lease, repositories: CollectedRepository[]) =>
			z
				.array(
					z.object({
						repository_id: z.string(),
						state: z.enum([
							"queued",
							"running",
							"succeeded",
							"failed",
							"canceled",
						]),
					}),
				)
				.parse(await jobRequest(lease, "repositories", { repositories })),
		publish: async (
			lease: Lease,
			repositoryId: string,
			state: "complete" | "partial",
			pullRequestCount: number,
			message: string,
			mergeRequirements?: MergeRequirement[],
		) =>
			collectionJobSchema.parse(
				await jobRequest(lease, "publish", {
					repositoryId,
					state,
					pullRequestCount,
					message: message.slice(0, 1000),
					mergeRequirements,
				}),
			),
		repositoryFail: (lease: Lease, repositoryId: string, message: string) =>
			jobRequest(lease, "repository-fail", {
				repositoryId,
				message: message.slice(0, 1000),
			}),
		complete: async (lease: Lease) =>
			collectionJobSchema.parse(await jobRequest(lease, "complete", {})),
		fail: (
			lease: Lease,
			kind:
				| "auth_required"
				| "forbidden"
				| "not_found"
				| "unavailable"
				| "invalid_data",
			message: string,
		) => jobRequest(lease, "fail", { kind, message: message.slice(0, 1000) }),
	};
}
export type CollectionClient = ReturnType<typeof createCollectionClient>;
