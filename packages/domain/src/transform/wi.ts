/**
 * Work item raw payloads → `Activity[]` (07 §6.2.2).
 *
 * Work items are project-scoped, not repo-scoped, so this is a separate entry
 * point from the pull-request transform with its own inputs.
 *
 * Closure is the subtle part. State NAMES are process-template specific
 * (Done / Closed / Completed / Resolved …), so matching on a name would work
 * on one project and silently emit nothing on the next. Closure is therefore
 * detected from `Microsoft.VSTS.Common.ClosedDate` going empty → non-empty,
 * falling back to the state's CATEGORY, which the caller resolves from
 * `/_apis/wit/workitemtypes/{type}/states` and passes in.
 */

import type { Activity } from "../activity.js";
import type { RawWiUpdate, RawWorkItem } from "../raw.js";
import {
	emptySkips,
	type Resolved,
	resolveIdentity,
	type TransformCommon,
	type TransformResult,
	toUnixSeconds,
} from "./pr.js";

export type WiTransformInput = TransformCommon & {
	projectExternalId: string;
	workItems: readonly RawWorkItem[];
	updatesByWi: ReadonlyMap<number, readonly RawWiUpdate[]>;
	/**
	 * `workItemType → (stateName → category)`. Resolved by the caller because a
	 * pure function cannot query the API. Missing entries simply mean the
	 * category fallback is unavailable for that type.
	 */
	stateCategories: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

/** Categories that mean "this work is finished". */
const CLOSED_CATEGORIES = new Set(["Completed", "Resolved"]);

function fieldString(
	fields: Record<string, unknown> | undefined,
	key: string,
): string | null {
	const v = fields?.[key];
	if (typeof v === "string") {
		return v;
	}
	if (v && typeof v === "object" && "uniqueName" in v) {
		const u = (v as { uniqueName?: unknown }).uniqueName;
		return typeof u === "string" ? u : null;
	}
	return null;
}

function identityField(
	fields: Record<string, unknown> | undefined,
	key: string,
) {
	const v = fields?.[key];
	return v && typeof v === "object"
		? (v as { uniqueName?: string; id?: string; isContainer?: boolean })
		: null;
}

/**
 * Does this revision close the work item?
 *
 * `ClosedDate` first: it is a stable field across process templates. The state
 * category is the fallback for templates that do not populate it.
 */
export function isClosingRevision(
	update: RawWiUpdate,
	workItemType: string | null,
	stateCategories: WiTransformInput["stateCategories"],
): boolean {
	const closedDate = update.fields?.["Microsoft.VSTS.Common.ClosedDate"];
	if (closedDate) {
		const before = closedDate.oldValue;
		const after = closedDate.newValue;
		if (!before && typeof after === "string" && after.length > 0) {
			return true;
		}
	}

	const state = update.fields?.["System.State"];
	if (!state || typeof state.newValue !== "string") {
		return false;
	}
	const categories = workItemType ? stateCategories.get(workItemType) : null;
	if (!categories) {
		return false;
	}
	const newCat = categories.get(state.newValue);
	if (!newCat || !CLOSED_CATEGORIES.has(newCat)) {
		return false;
	}
	// Only a TRANSITION into a closed category counts; an edit while already
	// closed must not emit a second closure.
	const oldCat =
		typeof state.oldValue === "string" ? categories.get(state.oldValue) : null;
	return !(oldCat && CLOSED_CATEGORIES.has(oldCat));
}

/** Group already-deduped update records by revision number, in rev order. */
export function groupByRev(
	updates: readonly RawWiUpdate[],
): Map<number, RawWiUpdate[]> {
	const out = new Map<number, RawWiUpdate[]>();
	for (const u of updates) {
		const list = out.get(u.rev);
		if (list) {
			list.push(u);
		} else {
			out.set(u.rev, [u]);
		}
	}
	return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
}

export type RevisionChoice =
	| { kind: "chosen"; update: RawWiUpdate }
	| { kind: "ambiguous"; reason: string };

/**
 * Pick the one record that represents a revision.
 *
 * A record with no `fields` diff changed nothing observable; when a rev has
 * both kinds, the substantive one is the revision. Timestamps must NOT decide
 * this — on live data the placeholder is consistently the earlier record.
 */
export function chooseRevisionRecord(
	group: readonly RawWiUpdate[],
): RevisionChoice {
	if (group.length === 1) {
		return { kind: "chosen", update: group[0] as RawWiUpdate };
	}
	const substantive = group.filter(
		(u) => Object.keys(u.fields ?? {}).length > 0,
	);
	if (substantive.length === 1) {
		return { kind: "chosen", update: substantive[0] as RawWiUpdate };
	}
	if (substantive.length === 0) {
		// All placeholders: nothing changed, so lowest id keeps it deterministic.
		const byId = [...group].sort(
			(a, b) => Number(a.id ?? 0) - Number(b.id ?? 0),
		);
		return { kind: "chosen", update: byId[0] as RawWiUpdate };
	}
	const authors = new Set(
		substantive.map((u) => u.revisedBy?.uniqueName ?? ""),
	);
	const dates = new Set(substantive.map((u) => u.revisedDate ?? ""));
	if (authors.size > 1 || dates.size > 1) {
		return {
			kind: "ambiguous",
			reason: `${substantive.length} records with field diffs disagree on author or time`,
		};
	}
	const byId = [...substantive].sort(
		(a, b) => Number(a.id ?? 0) - Number(b.id ?? 0),
	);
	return { kind: "chosen", update: byId[0] as RawWiUpdate };
}

class WiCollector {
	readonly result: TransformResult = {
		activities: [],
		unmatched: [],
		skipped: emptySkips(),
		anomalies: [],
	};
	private readonly seenUnmatched = new Set<string>();

	constructor(private readonly input: WiTransformInput) {}

	emit(
		type: Activity["type"],
		occurredAt: number | null,
		who: Resolved,
		sourceIds: unknown,
	): void {
		if (who.kind === "skip") {
			this.result.skipped[who.reason]++;
			return;
		}
		if (who.kind === "unmatched") {
			this.result.skipped.unmatched++;
			if (!this.seenUnmatched.has(who.uniqueName)) {
				this.seenUnmatched.add(who.uniqueName);
				this.result.unmatched.push({
					uniqueName: who.uniqueName,
					sampleOrg: this.input.org,
					sampleProject: this.input.project,
				});
			}
			return;
		}
		if (occurredAt === null) {
			this.result.skipped.no_timestamp++;
			return;
		}
		this.result.activities.push({
			type,
			occurredAt,
			provider: "ado",
			org: this.input.org,
			project: this.input.project,
			// Work items belong to a project, never a repo (05 §5.5).
			repoId: null,
			developerId: who.developerId,
			matchedUniqueName: who.uniqueName,
			sourceIds,
		} as Activity);
	}

	/** Record an anomaly; the caller must block the scope from committing. */
	anomaly(message: string): void {
		this.result.anomalies.push(message);
	}
}

export function transformWorkItems(input: WiTransformInput): TransformResult {
	const c = new WiCollector(input);
	const projectGuid = input.projectExternalId;

	for (const wi of input.workItems) {
		const wiId = wi.id;
		const fields = wi.fields as Record<string, unknown>;
		const workItemType = fieldString(fields, "System.WorkItemType");
		const core = { projectGuid, wiId };

		// wi.created — from the item's own fields, not its update stream, so a
		// truncated update history cannot lose the creation event.
		c.emit(
			"wi.created",
			toUnixSeconds(fieldString(fields, "System.CreatedDate")),
			resolveIdentity(identityField(fields, "System.CreatedBy"), input),
			core,
		);

		// Transport-level dedupe first: `id` is the update's real primary key.
		const byId = new Map<number | string, RawWiUpdate>();
		for (const [i, u] of (input.updatesByWi.get(wiId) ?? []).entries()) {
			byId.set(u.id ?? `idx-${i}`, u);
		}
		const updates = [...byId.values()].sort((a, b) => a.rev - b.rev);

		// wi.closed — the EARLIEST qualifying revision wins. The frozen
		// external_ref (`…:{wiId}:closed`) admits exactly one closure per work
		// item, so a reopen/reclose cycle must not rewrite it (07 §6.2.2).
		const closing = updates.find((u) =>
			isClosingRevision(u, workItemType, input.stateCategories),
		);
		if (closing) {
			c.emit(
				"wi.closed",
				toUnixSeconds(closing.revisedDate),
				resolveIdentity(closing.revisedBy, input),
				core,
			);
		}

		// wi.updated — one per revision NUMBER, choosing the SUBSTANTIVE record.
		//
		// ADO returns several update records sharing a `rev`: one carries the
		// actual field diff, the others are empty placeholders (link/relation
		// updates). The frozen external_ref is `…:{wiId}:rev:{revisionId}`, so
		// only one may be emitted per rev — and picking by timestamp picks wrong.
		// Measured on live data: in every duplicated rev the earliest record was
		// the EMPTY one, so "earliest" attributed the revision to the wrong
		// developer with a date months off. Prefer the record that actually
		// changed something (07 §6.2.3).
		for (const [rev, group] of groupByRev(updates)) {
			if (rev <= 1) {
				// rev 1 is the creation itself, already emitted from the item's
				// own fields; counting it again would double-count wi.created.
				continue;
			}
			const chosen = chooseRevisionRecord(group);
			if (chosen.kind === "ambiguous") {
				// Two records both claim to have changed this revision, and they
				// disagree on who or when. Guessing would corrupt attribution
				// silently, so surface it and let the scope block (01 §6.2).
				c.anomaly(`WI ${wiId} rev ${rev}: ${chosen.reason}`);
				continue;
			}
			c.emit(
				"wi.updated",
				toUnixSeconds(chosen.update.revisedDate),
				resolveIdentity(chosen.update.revisedBy, input),
				{ ...core, revisionId: rev },
			);
		}
	}

	return c.result;
}
