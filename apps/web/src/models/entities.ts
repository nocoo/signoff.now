export interface Developer {
	id: string;
	name: string;
	alias: string;
	avatarUrl: string | null;
	teamIds: string[];
	tagIds: string[];
	createdAt: number;
	updatedAt: number;
	archivedAt: number | null;
}

export interface Team {
	id: string;
	name: string;
	avatarUrl: string | null;
	tagIds: string[];
	createdAt: number;
	updatedAt: number;
	archivedAt: number | null;
}

export interface Tag {
	id: string;
	name: string;
	color: string;
	createdAt: number;
	updatedAt: number;
	archivedAt: number | null;
}

export interface Repo {
	id: string;
	provider: string;
	org: string;
	project: string;
	name: string;
	remoteUrl: string | null;
	externalId: string | null;
	/** ADO project GUID; null until backfilled. */
	projectExternalId: string | null;
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
	archivedAt: number | null;
}

/** A non-array (or missing) list is `[]`, never per-character garbage. */
function idList(v: unknown): string[] {
	return Array.isArray(v) ? v.map(String) : [];
}

/** `null` for absent, missing or non-string — the UI has one "no image" case. */
function optionalText(v: unknown): string | null {
	return v === null || v === undefined || typeof v !== "string" ? null : v;
}

export function parseDeveloper(raw: unknown): Developer {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		name: String(r.name),
		alias: String(r.alias),
		avatarUrl: optionalText(r.avatarUrl),
		// A developer created before memberships existed has no field at all;
		// an empty list keeps every consumer from guarding for undefined.
		teamIds: idList(r.teamIds),
		tagIds: idList(r.tagIds),
		createdAt: Number(r.createdAt),
		updatedAt: Number(r.updatedAt),
		archivedAt: r.archivedAt === null ? null : Number(r.archivedAt),
	};
}

export function parseTeam(raw: unknown): Team {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		name: String(r.name),
		avatarUrl: optionalText(r.avatarUrl),
		tagIds: idList(r.tagIds),
		createdAt: Number(r.createdAt),
		updatedAt: Number(r.updatedAt),
		archivedAt: r.archivedAt === null ? null : Number(r.archivedAt),
	};
}

export function parseTag(raw: unknown): Tag {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		name: String(r.name),
		color: String(r.color),
		createdAt: Number(r.createdAt),
		updatedAt: Number(r.updatedAt),
		archivedAt: r.archivedAt === null ? null : Number(r.archivedAt),
	};
}

export function parseRepo(raw: unknown): Repo {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		provider: String(r.provider),
		org: String(r.org),
		project: String(r.project),
		name: String(r.name),
		remoteUrl:
			r.remoteUrl === null || r.remoteUrl === undefined
				? null
				: String(r.remoteUrl),
		externalId:
			r.externalId === null || r.externalId === undefined
				? null
				: String(r.externalId),
		projectExternalId:
			r.projectExternalId === null || r.projectExternalId === undefined
				? null
				: String(r.projectExternalId),
		enabled: Boolean(r.enabled),
		createdAt: Number(r.createdAt),
		updatedAt: Number(r.updatedAt),
		archivedAt: r.archivedAt === null ? null : Number(r.archivedAt),
	};
}

export function validateDeveloperInput(
	name: string,
	alias: string,
): string | null {
	if (!name.trim()) {
		return "Name is required";
	}
	if (!alias.trim() || alias.includes("@")) {
		return "Alias is required (no @)";
	}
	return null;
}

/**
 * Reject an avatar URL before it reaches the server, so the user sees the
 * problem next to the field rather than as a failed save. The server checks
 * this too — this is a nicety, not the boundary.
 */
export function validateAvatarUrl(url: string): string | null {
	const t = url.trim();
	if (!t) {
		return null;
	}
	let u: URL;
	try {
		u = new URL(t);
	} catch {
		return "Avatar URL must be an absolute http(s) URL";
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		return "Avatar URL must use http or https";
	}
	return null;
}

export type DeveloperFilter = {
	keyword: string;
	/** `archived` is a distinct choice from "everything", not a superset. */
	status: "active" | "archived" | "all";
	teamId: string | null;
	tagId: string | null;
};

export const EMPTY_DEVELOPER_FILTER: DeveloperFilter = {
	keyword: "",
	status: "active",
	teamId: null,
	tagId: null,
};

/**
 * Narrow the roster by keyword, archive status and team.
 *
 * Kept out of the view so it is covered: the filter is the one piece here whose
 * being wrong is invisible (a name that quietly never appears looks the same as
 * a name that is not there).
 */
export function filterDevelopers(
	items: readonly Developer[],
	filter: DeveloperFilter,
): Developer[] {
	const kw = filter.keyword.trim().toLowerCase();
	return items.filter((d) => {
		if (filter.status === "active" && d.archivedAt !== null) {
			return false;
		}
		if (filter.status === "archived" && d.archivedAt === null) {
			return false;
		}
		if (filter.teamId !== null && !d.teamIds.includes(filter.teamId)) {
			return false;
		}
		if (filter.tagId !== null && !d.tagIds.includes(filter.tagId)) {
			return false;
		}
		// A blank keyword needs no special case: `includes("")` is true for all.
		// Alias as well as name: the alias is what the pipeline matches on, so
		// it is what someone debugging a missing developer will search for.
		return (
			d.name.toLowerCase().includes(kw) || d.alias.toLowerCase().includes(kw)
		);
	});
}
