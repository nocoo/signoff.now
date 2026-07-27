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

		// Order by rev, then by revision time, so "the earliest record for a
		// rev" is well defined regardless of the order the API returned them.
		const updates = [...(input.updatesByWi.get(wiId) ?? [])].sort(
			(a, b) =>
				a.rev - b.rev ||
				(Date.parse(a.revisedDate ?? "") || 0) -
					(Date.parse(b.revisedDate ?? "") || 0),
		);

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

		// wi.updated — one per revision NUMBER, not per update record.
		//
		// Live data contains several update records sharing a `rev` (the extras
		// carry no field diff and appear to be link/relation updates). The frozen
		// external_ref is `…:{wiId}:rev:{revisionId}`, so emitting both would
		// produce two Activities with the same ref: the server UPSERTs by ref, so
		// one would silently overwrite the other and the surviving row would
		// depend on chunk ordering. Keep the earliest record for each rev —
		// deterministic on replay (01 §6.2).
		const seenRev = new Set<number>();
		for (const u of updates) {
			if (u.rev <= 1 || seenRev.has(u.rev)) {
				continue;
			}
			seenRev.add(u.rev);
			c.emit(
				"wi.updated",
				toUnixSeconds(u.revisedDate),
				resolveIdentity(u.revisedBy, input),
				{ ...core, revisionId: u.rev },
			);
		}
	}

	return c.result;
}
