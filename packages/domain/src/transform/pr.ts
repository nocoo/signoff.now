/**
 * Raw Azure DevOps payloads → `Activity[]` (07 §6).
 *
 * Pure: no I/O, no clock, no network. Everything the rules need is passed in,
 * so the same raw JSON always produces the same Activities — that determinism
 * is what makes 01 §6.2's "any Activity must be rebuildable from raw" true.
 *
 * The bias throughout is to DROP rather than guess. A missing timestamp is not
 * an inconvenience to work around; inventing one silently corrupts the score.
 */

import type { Activity } from "../activity.js";
import { matchDeveloper } from "../identity.js";
import type { RawIdentity, RawIteration, RawPr, RawThread } from "../raw.js";
import { propNumber, propString } from "../raw.js";

export type TransformCommon = {
	settings: { emailSuffixes: readonly string[] };
	developers: readonly { id: string; alias: string }[];
	org: string;
	project: string;
};

export type PrTransformInput = TransformCommon & {
	repo: { id: string; externalId: string };
	projectExternalId: string;
	prs: readonly RawPr[];
	threadsByPr: ReadonlyMap<number, readonly RawThread[]>;
	iterationsByPr: ReadonlyMap<number, readonly RawIteration[]>;
};

/** Why an identity produced no Activity. Drives the run report (07 §6.4). */
export type SkipReason =
	| "container"
	| "non_email"
	| "unmatched"
	| "no_timestamp"
	| "guid_mismatch"
	| "vote_ambiguous"
	| "vote_withdrawn"
	| "no_merge_commit";

export type TransformResult = {
	activities: Activity[];
	/** Human identities that matched no developer (07 §6.4 rule 2). */
	unmatched: { uniqueName: string; sampleOrg: string; sampleProject: string }[];
	/** Counts by reason, so a blind spot is visible rather than silent. */
	skipped: Record<SkipReason, number>;
	/** Anomalies that must block the cursor (07 §6.4 rule 4). */
	anomalies: string[];
};

export function emptySkips(): Record<SkipReason, number> {
	return {
		container: 0,
		non_email: 0,
		unmatched: 0,
		no_timestamp: 0,
		guid_mismatch: 0,
		vote_ambiguous: 0,
		vote_withdrawn: 0,
		no_merge_commit: 0,
	};
}

/** ISO 8601 → positive UTC unix seconds, or null when unusable. */
export function toUnixSeconds(iso: string | null | undefined): number | null {
	if (!iso) {
		return null;
	}
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) {
		return null;
	}
	const s = Math.floor(ms / 1000);
	return s > 0 ? s : null;
}

export type Resolved =
	| { kind: "developer"; developerId: string; uniqueName: string }
	| { kind: "skip"; reason: SkipReason }
	| { kind: "unmatched"; uniqueName: string };

/**
 * Resolve an ADO identity to a developer.
 *
 * Containers and non-email identities are skipped WITHOUT being recorded as
 * unmatched (01 §4.1) — review groups would otherwise drown the report. They
 * are still counted by reason so the exclusion stays visible.
 */
export function resolveIdentity(
	identity: RawIdentity | null | undefined,
	input: TransformCommon,
): Resolved {
	if (identity?.isContainer === true) {
		return { kind: "skip", reason: "container" };
	}
	const uniqueName = (identity?.uniqueName ?? "").trim();
	if (!uniqueName.includes("@")) {
		return { kind: "skip", reason: "non_email" };
	}
	const dev = matchDeveloper(
		uniqueName,
		input.developers,
		input.settings.emailSuffixes,
	);
	return dev
		? { kind: "developer", developerId: dev.id, uniqueName }
		: { kind: "unmatched", uniqueName };
}

/**
 * The single system comment that carries a vote's time and author.
 * A thread with none, or more than one, is ambiguous — 01 §6.2 says discard
 * rather than pick one arbitrarily.
 */
export function voteComment(thread: RawThread) {
	const system = (thread.comments ?? []).filter(
		(c) => c.commentType === "system",
	);
	return system.length === 1 ? system[0] : null;
}

/**
 * Shared bookkeeping for one transform run: emits Activities and records why
 * anything was dropped, so a blind spot shows up as a count instead of silence.
 */
class Collector {
	readonly result: TransformResult = {
		activities: [],
		unmatched: [],
		skipped: emptySkips(),
		anomalies: [],
	};
	private readonly seenUnmatched = new Set<string>();

	constructor(private readonly input: PrTransformInput) {}

	/** Returns the developer id, or null after recording why there is none. */
	developerId(r: Resolved): string | null {
		if (r.kind === "developer") {
			return r.developerId;
		}
		if (r.kind === "skip") {
			this.result.skipped[r.reason]++;
			return null;
		}
		this.result.skipped.unmatched++;
		if (!this.seenUnmatched.has(r.uniqueName)) {
			this.seenUnmatched.add(r.uniqueName);
			this.result.unmatched.push({
				uniqueName: r.uniqueName,
				sampleOrg: this.input.org,
				sampleProject: this.input.project,
			});
		}
		return null;
	}

	skip(reason: SkipReason): void {
		this.result.skipped[reason]++;
	}

	anomaly(reason: SkipReason, message: string): void {
		this.result.skipped[reason]++;
		this.result.anomalies.push(message);
	}

	/**
	 * Emit one Activity. `occurredAt` may be null — that means the stable source
	 * lacked a timestamp, and 01 §6.2 says drop rather than invent one.
	 */
	emit(
		type: Activity["type"],
		occurredAt: number | null,
		who: Resolved,
		sourceIds: unknown,
	): void {
		const developerId = this.developerId(who);
		if (!developerId || who.kind !== "developer") {
			return;
		}
		if (occurredAt === null) {
			this.skip("no_timestamp");
			return;
		}
		this.result.activities.push({
			type,
			occurredAt,
			provider: "ado",
			// From the bound repo row, not the raw payload: casing can differ and
			// the server cross-checks these against the repo record.
			org: this.input.org,
			project: this.input.project,
			repoId: this.input.repo.id,
			developerId,
			matchedUniqueName: who.uniqueName,
			sourceIds,
		} as Activity);
	}
}

/** True when the payload really came from the repo we think it did. */
function boundToRepo(pr: RawPr, input: PrTransformInput): boolean {
	return (
		pr.repository.id.toLowerCase() === input.repo.externalId.toLowerCase() &&
		pr.repository.project.id.toLowerCase() ===
			input.projectExternalId.toLowerCase()
	);
}

function collectAuthorSide(
	pr: RawPr,
	input: PrTransformInput,
	c: Collector,
): void {
	const sourceIds = {
		prRepoGuid: input.repo.externalId,
		prId: pr.pullRequestId,
	};
	const author = resolveIdentity(pr.createdBy, input);

	c.emit("pr.created", toUnixSeconds(pr.creationDate), author, sourceIds);

	if (pr.status === "completed") {
		if (!pr.lastMergeCommit?.commitId) {
			// Not a silent drop: every live sample had one, so its absence means
			// the assumption is wrong and must surface (07 §6.4 rule 4).
			c.anomaly(
				"no_merge_commit",
				`PR ${pr.pullRequestId}: status=completed without lastMergeCommit`,
			);
			return;
		}
		c.emit("pr.merged", toUnixSeconds(pr.closedDate), author, sourceIds);
		return;
	}

	if (pr.status === "abandoned") {
		c.emit("pr.closed", toUnixSeconds(pr.closedDate), author, sourceIds);
	}
}

function collectVotes(pr: RawPr, input: PrTransformInput, c: Collector): void {
	for (const thread of input.threadsByPr.get(pr.pullRequestId) ?? []) {
		if (
			propString(thread.properties, "CodeReviewThreadType") !== "VoteUpdate"
		) {
			continue;
		}
		// The payload types this as a string ("10"), so compare numerically —
		// `"0" !== 0` would count a withdrawal as a vote.
		const vote = propNumber(thread.properties, "CodeReviewVoteResult");
		if (vote === null || vote === 0) {
			c.skip("vote_withdrawn");
			continue;
		}
		const comment = voteComment(thread);
		if (!comment) {
			c.skip("vote_ambiguous");
			continue;
		}
		c.emit(
			"pr.vote",
			toUnixSeconds(comment.publishedDate),
			resolveIdentity(comment.author, input),
			{
				prRepoGuid: input.repo.externalId,
				prId: pr.pullRequestId,
				voterIdentityId: comment.author?.id ?? "",
				threadId: thread.id,
				commentId: comment.id,
			},
		);
	}
}

function collectIterations(
	pr: RawPr,
	input: PrTransformInput,
	c: Collector,
): void {
	for (const it of input.iterationsByPr.get(pr.pullRequestId) ?? []) {
		c.emit(
			"pr.active",
			toUnixSeconds(it.updatedDate),
			resolveIdentity(it.author, input),
			{
				prRepoGuid: input.repo.externalId,
				prId: pr.pullRequestId,
				iterationId: it.id,
			},
		);
	}
}

export function transformPullRequests(
	input: PrTransformInput,
): TransformResult {
	const c = new Collector(input);

	for (const pr of input.prs) {
		// A payload from another repo would be rejected server-side (05 §5.5);
		// attributing it locally would be worse than failing.
		if (!boundToRepo(pr, input)) {
			c.anomaly(
				"guid_mismatch",
				`PR ${pr.pullRequestId}: repository/project GUID does not match the bound repo`,
			);
			continue;
		}
		collectAuthorSide(pr, input, c);
		collectVotes(pr, input, c);
		collectIterations(pr, input, c);
	}

	return c.result;
}
