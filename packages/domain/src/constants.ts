/** Activity types and default weights (01 §6.3). Weights are non-negative integers. */

export const ACTIVITY_TYPES = [
	"pr.merged",
	"pr.closed",
	"pr.created",
	"pr.vote",
	"pr.active",
	"wi.created",
	"wi.updated",
	"wi.closed",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const DEFAULT_WEIGHTS: Readonly<Record<ActivityType, number>> = {
	"pr.merged": 10,
	"pr.closed": 2,
	"pr.created": 2,
	"pr.vote": 3,
	"pr.active": 2,
	"wi.created": 3,
	"wi.updated": 1,
	"wi.closed": 5,
};
