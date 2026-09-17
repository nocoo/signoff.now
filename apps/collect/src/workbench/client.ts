import {
	type CollectorClaim,
	collectorClaimSchema,
} from "@signoff/domain/collection";
import {
	type CollectorStatus,
	collectionJobSchema,
	type Project,
	type ProjectWrite,
	type PullRequest,
	projectSchema,
	scanRunSchema,
	workbenchSchema,
} from "@signoff/domain/workbench";
import { type FetchLike, pipelineRequest } from "../pipeline/client.ts";

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
	};
	const request = (method: string, path: string, body?: unknown) =>
		pipelineRequest(config, method, path, body);
	const jobRequest = (lease: Lease, action: string, body: object) =>
		request(
			"POST",
			`/api/collector/jobs/${encodeURIComponent(lease.job.id)}/${action}`,
			{ ...body, leaseToken: lease.leaseToken },
		);
	return {
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
			request("POST", "/api/collector/heartbeat", { state, message }),
		claim: async () => {
			const raw = await request("POST", "/api/collector/claim");
			return raw === null ? null : collectorClaimSchema.parse(raw);
		},
		progress: (
			lease: Lease,
			completedPulls: number,
			totalPulls: number | null,
			message: string,
		) => jobRequest(lease, "progress", { completedPulls, totalPulls, message }),
		upload: async (lease: Lease, pulls: PullRequest[]) => {
			for (const chunk of collectionChunks(pulls))
				await jobRequest(lease, "batch", { pulls: chunk });
		},
		complete: async (
			lease: Lease,
			state: "complete" | "partial",
			pullRequestCount: number,
			message: string,
		) =>
			scanRunSchema.parse(
				await jobRequest(lease, "complete", {
					state,
					pullRequestCount,
					message,
				}),
			),
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
