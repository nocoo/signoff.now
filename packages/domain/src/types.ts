/**
 * Function type aliases for 06 implementations.
 * 05 delivers signatures only — no impl files.
 */

import type { Activity } from "./activity.js";
import type { ActivityType } from "./constants.js";

export type MatchDeveloper = (
	uniqueName: string,
	developers: readonly { id: string; alias: string }[],
	suffixes: readonly string[],
) => { id: string } | null;

export type DayKey = (occurredAtSec: number, timeZone: string) => string;

export type BuildExternalRef = (
	type: ActivityType,
	sourceIds: unknown,
) => string;

export type ScoreRow = {
	developerId: string;
	dayKey: string;
	total: number;
	breakdown: Partial<Record<ActivityType, number>>;
	activityCount: number;
};

export type AggregateScores = (
	activities: readonly Activity[],
	weights: Readonly<Record<ActivityType, number>>,
) => ScoreRow[];
