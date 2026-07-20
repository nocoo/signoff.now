export interface Developer {
	id: string;
	name: string;
	alias: string;
	createdAt: number;
	updatedAt: number;
	archivedAt: number | null;
}

export interface Team {
	id: string;
	name: string;
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

export function parseDeveloper(raw: unknown): Developer {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		name: String(r.name),
		alias: String(r.alias),
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
