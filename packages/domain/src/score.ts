/**
 * aggregateScores — 06 §3 fold rules (pure, order-independent).
 * Each activity must carry dayKey (server attaches after dayKey()).
 */

import type { Activity } from "./activity.js";
import type { ActivityType } from "./constants.js";
import type { ScoreRow } from "./types.js";

/** Activity plus server-computed dayKey for aggregation. */
export type ActivityWithDayKey = Activity & { dayKey: string };

const PR_AUTH_PRIORITY: ActivityType[] = [
	"pr.merged",
	"pr.closed",
	"pr.created",
	"pr.active",
];

function prKey(sourceIds: unknown): string {
	const s = sourceIds as { prRepoGuid: string; prId: number };
	return `${s.prRepoGuid}:${s.prId}`;
}

function wiKey(sourceIds: unknown): string {
	const s = sourceIds as { projectGuid: string; wiId: number };
	return `${s.projectGuid}:${s.wiId}`;
}

function maxPrAuthType(types: Set<ActivityType>): ActivityType {
	return PR_AUTH_PRIORITY.find((t) => types.has(t)) ?? "pr.merged";
}

function addWeight(
	breakdown: Partial<Record<ActivityType, number>>,
	type: ActivityType,
	weight: number,
): void {
	if (weight === 0) {
		return;
	}
	breakdown[type] = (breakdown[type] ?? 0) + weight;
}

export function aggregateScores(
	activities: readonly ActivityWithDayKey[],
	weights: Readonly<Record<ActivityType, number>>,
): ScoreRow[] {
	const byDevDay = new Map<string, ActivityWithDayKey[]>();
	for (const a of activities) {
		const key = `${a.developerId}\0${a.dayKey}`;
		const list = byDevDay.get(key) ?? [];
		list.push(a);
		byDevDay.set(key, list);
	}

	const rows: ScoreRow[] = [];
	for (const [, group] of byDevDay) {
		const head = group[0];
		if (!head) {
			continue;
		}
		const developerId = head.developerId;
		const dayKeyVal = head.dayKey;
		const activityCount = group.length;
		const breakdown: Partial<Record<ActivityType, number>> = {};

		const votes = group.filter((a) => a.type === "pr.vote");
		const wiUpd = group.filter((a) => a.type === "wi.updated");
		const wiOther = group.filter(
			(a) => a.type === "wi.created" || a.type === "wi.closed",
		);
		const prAuth = group.filter(
			(a) =>
				a.type === "pr.merged" ||
				a.type === "pr.closed" ||
				a.type === "pr.created" ||
				a.type === "pr.active",
		);

		for (const _ of votes) {
			addWeight(breakdown, "pr.vote", weights["pr.vote"] ?? 0);
		}

		for (const a of wiOther) {
			addWeight(breakdown, a.type, weights[a.type] ?? 0);
		}

		const wiSeen = new Set<string>();
		for (const a of wiUpd) {
			const k = wiKey(a.sourceIds);
			if (wiSeen.has(k)) {
				continue;
			}
			wiSeen.add(k);
			addWeight(breakdown, "wi.updated", weights["wi.updated"] ?? 0);
		}

		const prGroups = new Map<string, Set<ActivityType>>();
		for (const a of prAuth) {
			const k = prKey(a.sourceIds);
			const set = prGroups.get(k) ?? new Set();
			set.add(a.type);
			prGroups.set(k, set);
		}
		for (const [, types] of prGroups) {
			const t = maxPrAuthType(types);
			addWeight(breakdown, t, weights[t] ?? 0);
		}

		let total = 0;
		for (const v of Object.values(breakdown)) {
			if (typeof v === "number") {
				total += v;
			}
		}

		rows.push({
			developerId,
			dayKey: dayKeyVal,
			total,
			breakdown,
			activityCount,
		});
	}

	return rows;
}
