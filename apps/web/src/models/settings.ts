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

export const WEIGHT_LABELS: Record<string, string> = {
	"pr.merged": "PR merged",
	"pr.closed": "PR closed",
	"pr.created": "PR created",
	"pr.vote": "PR vote",
	"pr.active": "PR active",
	"wi.created": "WI created",
	"wi.updated": "WI updated",
	"wi.closed": "WI closed",
};

export interface AppSettings {
	timezone: string;
	emailSuffixes: string[];
	activityWeights: Record<string, number>;
	pipelineConfigVersion: number;
	scoresStale: boolean;
	scoresStaleReason: string | null;
	updatedAt?: Record<string, number>;
}

export interface SettingsFormState {
	timezone: string;
	emailSuffixes: string[];
	activityWeights: Record<string, number>;
}

export function parseSettings(raw: unknown): AppSettings {
	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid settings payload");
	}
	const r = raw as Record<string, unknown>;
	return {
		timezone: String(r.timezone ?? "Asia/Shanghai"),
		emailSuffixes: Array.isArray(r.emailSuffixes)
			? r.emailSuffixes.map(String)
			: ["example.com"],
		activityWeights:
			r.activityWeights && typeof r.activityWeights === "object"
				? { ...DEFAULT_ACTIVITY_WEIGHTS, ...(r.activityWeights as object) }
				: { ...DEFAULT_ACTIVITY_WEIGHTS },
		pipelineConfigVersion: Number(r.pipelineConfigVersion ?? 1),
		scoresStale: Boolean(r.scoresStale),
		scoresStaleReason:
			r.scoresStaleReason === null || r.scoresStaleReason === undefined
				? null
				: String(r.scoresStaleReason),
		updatedAt:
			r.updatedAt && typeof r.updatedAt === "object"
				? (r.updatedAt as Record<string, number>)
				: undefined,
	};
}

export function toFormState(s: AppSettings): SettingsFormState {
	return {
		timezone: s.timezone,
		emailSuffixes: [...s.emailSuffixes],
		activityWeights: { ...s.activityWeights },
	};
}

export function isFormDirty(
	form: SettingsFormState,
	baseline: SettingsFormState,
): boolean {
	return JSON.stringify(form) !== JSON.stringify(baseline);
}

export function validateForm(form: SettingsFormState): string | null {
	if (!form.timezone.trim()) {
		return "Timezone is required";
	}
	if (form.emailSuffixes.length === 0) {
		return "At least one email suffix is required";
	}
	for (const s of form.emailSuffixes) {
		if (!s || s.includes("@")) {
			return "Invalid email suffix";
		}
	}
	for (const [k, v] of Object.entries(form.activityWeights)) {
		if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
			return `Invalid weight for ${k} (must be a non-negative integer)`;
		}
		if (v < 0) {
			return `Invalid weight for ${k} (must be a non-negative integer)`;
		}
	}
	return null;
}

export function normalizeSuffixInput(raw: string): string {
	return raw.trim().toLowerCase();
}
