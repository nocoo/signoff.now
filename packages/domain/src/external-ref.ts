/**
 * buildExternalRef — 02 §5.2 templates from type + sourceIds.
 */

import type { ActivityType } from "./constants.js";

type PrCore = { prRepoGuid: string; prId: number };
type PrVote = PrCore & {
	voterIdentityId: string;
	threadId: number;
	commentId: number;
};
type PrActive = PrCore & { iterationId: number };
type WiCore = { projectGuid: string; wiId: number };
type WiUpdate = WiCore & { revisionId: number };

function asRecord(sourceIds: unknown): Record<string, unknown> {
	if (sourceIds === null || typeof sourceIds !== "object") {
		throw new Error("sourceIds must be an object");
	}
	return sourceIds as Record<string, unknown>;
}

export function buildExternalRef(
	type: ActivityType,
	sourceIds: unknown,
): string {
	const s = asRecord(sourceIds);
	if (type === "pr.created" || type === "pr.merged" || type === "pr.closed") {
		const { prRepoGuid, prId } = s as PrCore;
		const suffix = type.slice("pr.".length);
		return `ado:pr:${prRepoGuid}:${prId}:${suffix}`;
	}
	if (type === "pr.vote") {
		const v = s as PrVote;
		return `ado:pr:${v.prRepoGuid}:${v.prId}:vote:${v.voterIdentityId}:${v.threadId}:${v.commentId}`;
	}
	if (type === "pr.active") {
		const a = s as PrActive;
		return `ado:pr:${a.prRepoGuid}:${a.prId}:iter:${a.iterationId}`;
	}
	if (type === "wi.created" || type === "wi.closed") {
		const w = s as WiCore;
		const suffix = type.slice("wi.".length);
		return `ado:wi:${w.projectGuid}:${w.wiId}:${suffix}`;
	}
	// wi.updated
	const u = s as WiUpdate;
	return `ado:wi:${u.projectGuid}:${u.wiId}:rev:${u.revisionId}`;
}
