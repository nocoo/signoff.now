/** Settings domain: parse, validate, diff, recompute kind (docs/04). */

export const DEFAULT_ACTIVITY_WEIGHTS: Record<string, number> = {
	"pr.merged": 10,
	"pr.closed": 2,
	"pr.created": 2,
	"pr.vote": 3,
	"pr.active": 2,
	"wi.created": 3,
	"wi.updated": 1,
	"wi.closed": 5,
};

export type RecomputeKind = "full_rematch" | "none";

export interface AppSettings {
	timezone: string;
	emailSuffixes: string[];
	activityWeights: Record<string, number>;
	pipelineConfigVersion: number;
	scoresStale: boolean;
	scoresStaleReason: string | null;
	updatedAt: Record<string, number>;
}

export interface SettingsBusinessInput {
	timezone: string;
	emailSuffixes: string[];
	activityWeights: Record<string, number>;
}

export type SettingsRow = { key: string; value: string; updated_at: number };

function parseJsonValue(raw: string): unknown {
	return JSON.parse(raw) as unknown;
}

export function normalizeEmailSuffixes(input: unknown): string[] | null {
	if (!Array.isArray(input) || input.length === 0) {
		return null;
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of input) {
		if (typeof item !== "string") {
			return null;
		}
		const s = item.trim().toLowerCase();
		if (!s || s.includes("@") || s.includes(" ")) {
			return null;
		}
		if (seen.has(s)) {
			continue;
		}
		seen.add(s);
		out.push(s);
	}
	return out.length >= 1 ? out : null;
}

/**
 * Activity weights must be non-negative integers (D1 scores.total is INTEGER).
 * Rejects floats, negatives, NaN, non-numbers.
 */
export function normalizeActivityWeights(
	input: unknown,
): Record<string, number> | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return null;
	}
	const out: Record<string, number> = { ...DEFAULT_ACTIVITY_WEIGHTS };
	for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
		if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
			return null;
		}
		if (v < 0) {
			return null;
		}
		out[k] = v;
	}
	for (const key of Object.keys(DEFAULT_ACTIVITY_WEIGHTS)) {
		if (typeof out[key] !== "number") {
			out[key] = DEFAULT_ACTIVITY_WEIGHTS[key] ?? 0;
		}
	}
	return out;
}

export function validateTimezone(tz: unknown): string | null {
	if (typeof tz !== "string" || tz.trim() === "") {
		return null;
	}
	const t = tz.trim();
	try {
		Intl.DateTimeFormat(undefined, { timeZone: t });
		return t;
	} catch {
		return null;
	}
}

export function rowsToAppSettings(rows: SettingsRow[]): AppSettings {
	const map = new Map(rows.map((r) => [r.key, r]));
	const updatedAt: Record<string, number> = {};
	for (const r of rows) {
		updatedAt[r.key] = r.updated_at;
	}

	const tzRaw = map.get("timezone")?.value ?? '"Asia/Shanghai"';
	const suffixesRaw = map.get("email_suffixes")?.value ?? '["example.com"]';
	const weightsRaw =
		map.get("activity_weights")?.value ??
		JSON.stringify(DEFAULT_ACTIVITY_WEIGHTS);
	const versionRaw = map.get("pipeline_config_version")?.value ?? "1";
	const staleRaw = map.get("scores_stale")?.value ?? "false";
	const reasonRaw = map.get("scores_stale_reason")?.value ?? "null";

	const timezone = validateTimezone(parseJsonValue(tzRaw)) ?? "Asia/Shanghai";
	const emailSuffixes = normalizeEmailSuffixes(parseJsonValue(suffixesRaw)) ?? [
		"example.com",
	];
	const activityWeights = normalizeActivityWeights(
		parseJsonValue(weightsRaw),
	) ?? {
		...DEFAULT_ACTIVITY_WEIGHTS,
	};
	const pipelineConfigVersion = Number(parseJsonValue(versionRaw));
	const scoresStale = Boolean(parseJsonValue(staleRaw));
	const reasonParsed = parseJsonValue(reasonRaw);
	const scoresStaleReason =
		reasonParsed === null || reasonParsed === undefined
			? null
			: String(reasonParsed);

	return {
		timezone,
		emailSuffixes,
		activityWeights,
		pipelineConfigVersion: Number.isFinite(pipelineConfigVersion)
			? pipelineConfigVersion
			: 1,
		scoresStale,
		scoresStaleReason,
		updatedAt,
	};
}

export function parseBusinessInput(
	body: unknown,
):
	| { ok: true; value: SettingsBusinessInput; expectedVersion: number }
	| { ok: false; error: string } {
	if (!body || typeof body !== "object") {
		return { ok: false, error: "Invalid payload" };
	}
	const b = body as Record<string, unknown>;
	if (
		typeof b.expectedVersion !== "number" ||
		!Number.isInteger(b.expectedVersion)
	) {
		return { ok: false, error: "expectedVersion is required (integer)" };
	}
	const timezone = validateTimezone(b.timezone);
	if (!timezone) {
		return { ok: false, error: "Invalid timezone" };
	}
	const emailSuffixes = normalizeEmailSuffixes(b.emailSuffixes);
	if (!emailSuffixes) {
		return { ok: false, error: "Invalid emailSuffixes" };
	}
	const activityWeights = normalizeActivityWeights(b.activityWeights);
	if (!activityWeights) {
		return { ok: false, error: "Invalid activityWeights" };
	}
	return {
		ok: true,
		expectedVersion: b.expectedVersion,
		value: { timezone, emailSuffixes, activityWeights },
	};
}

export function diffBusiness(
	current: AppSettings,
	next: SettingsBusinessInput,
): {
	changed: boolean;
	timezoneChanged: boolean;
	suffixesChanged: boolean;
	weightsChanged: boolean;
	recomputeKind: RecomputeKind;
	reason: string | null;
} {
	const timezoneChanged = current.timezone !== next.timezone;
	const suffixesChanged =
		JSON.stringify(current.emailSuffixes) !==
		JSON.stringify(next.emailSuffixes);
	const weightsChanged =
		JSON.stringify(current.activityWeights) !==
		JSON.stringify(next.activityWeights);
	const changed = timezoneChanged || suffixesChanged || weightsChanged;

	if (!changed) {
		return {
			changed: false,
			timezoneChanged,
			suffixesChanged,
			weightsChanged,
			recomputeKind: "none",
			reason: null,
		};
	}

	const parts: string[] = [];
	if (timezoneChanged) {
		parts.push("timezone");
	}
	if (suffixesChanged) {
		parts.push("email_suffixes");
	}
	if (weightsChanged) {
		parts.push("activity_weights");
	}

	return {
		changed: true,
		timezoneChanged,
		suffixesChanged,
		weightsChanged,
		recomputeKind: "full_rematch",
		reason: `${parts.join(", ")} updated`,
	};
}

/** JSON text for settings.value column. */
export function jsonText(value: unknown): string {
	return JSON.stringify(value);
}
