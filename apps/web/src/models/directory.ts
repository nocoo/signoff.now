import type {
	DataSource,
	DirectoryData,
	DirectoryIdentity,
	DirectoryMember,
	DirectoryTag,
	DirectoryTeam,
	MemberDraft,
	TagDraft,
	TeamDraft,
} from "@signoff/domain/insights";

export type DirectoryKind = "members" | "teams" | "tags";
export interface DirectoryDraftMap {
	members: MemberDraft;
	teams: TeamDraft;
	tags: TagDraft;
}
export type DirectoryEditor = {
	[K in DirectoryKind]: {
		kind: K;
		id: string | null;
		revision: number;
		draft: DirectoryDraftMap[K];
		followKey: string | null;
	};
}[DirectoryKind];

export interface DirectoryFilter {
	keyword: string;
	status: "active" | "archived" | "all";
	teamId: string;
	tagId: string;
	view: "followed" | "discover";
}
export const DEFAULT_DIRECTORY_FILTER: DirectoryFilter = {
	keyword: "",
	status: "active",
	teamId: "",
	tagId: "",
	view: "followed",
};
export const directoryStorageKey = (source: DataSource, kind: DirectoryKind) =>
	`signoff-directory-${source}-${kind}`;

export function readDirectoryFilters(
	source: DataSource,
	kind: DirectoryKind,
): DirectoryFilter {
	try {
		const saved = JSON.parse(
			localStorage.getItem(directoryStorageKey(source, kind)) ?? "null",
		);
		if (!saved || typeof saved !== "object" || Array.isArray(saved))
			return { ...DEFAULT_DIRECTORY_FILTER };
		return {
			keyword: typeof saved.keyword === "string" ? saved.keyword : "",
			status:
				saved.status === "archived" || saved.status === "all"
					? saved.status
					: "active",
			teamId: typeof saved.teamId === "string" ? saved.teamId : "",
			tagId: typeof saved.tagId === "string" ? saved.tagId : "",
			view: saved.view === "discover" ? "discover" : "followed",
		};
	} catch {
		return { ...DEFAULT_DIRECTORY_FILTER };
	}
}

export function writeDirectoryFilters(
	source: DataSource,
	kind: DirectoryKind,
	filter: DirectoryFilter,
): void {
	try {
		localStorage.setItem(
			directoryStorageKey(source, kind),
			JSON.stringify(filter),
		);
	} catch {
		// Filters remain usable when browser storage is unavailable.
	}
}

const statusMatches = (
	archivedAt: number | null,
	status: DirectoryFilter["status"],
) =>
	status === "all" ||
	(status === "active" ? archivedAt === null : archivedAt !== null);
const matches = (query: string, ...values: (string | null)[]) =>
	values
		.join(" ")
		.toLocaleLowerCase()
		.includes(query.trim().toLocaleLowerCase());
const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name);

export function filterMembers(
	data: DirectoryData,
	filter: DirectoryFilter,
): DirectoryMember[] {
	const identities = new Map(
		data.identities.map((identity) => [identity.key, identity]),
	);
	return data.members
		.filter((member) => {
			const accounts = member.identityKeys.flatMap((key) => {
				const identity = identities.get(key);
				return identity
					? [identity.name, identity.handle, identity.organization]
					: [];
			});
			return (
				statusMatches(member.archivedAt, filter.status) &&
				(!filter.teamId || member.teamIds.includes(filter.teamId)) &&
				(!filter.tagId || member.tagIds.includes(filter.tagId)) &&
				matches(filter.keyword, member.name, ...accounts)
			);
		})
		.sort(byName);
}

export function filterTeams(
	data: DirectoryData,
	filter: DirectoryFilter,
): DirectoryTeam[] {
	return data.teams
		.filter(
			(team) =>
				statusMatches(team.archivedAt, filter.status) &&
				(!filter.tagId || team.tagIds.includes(filter.tagId)) &&
				matches(filter.keyword, team.name),
		)
		.sort(byName);
}

export function filterTags(
	data: DirectoryData,
	filter: DirectoryFilter,
): DirectoryTag[] {
	return data.tags
		.filter(
			(tag) =>
				statusMatches(tag.archivedAt, filter.status) &&
				matches(filter.keyword, tag.name),
		)
		.sort(byName);
}

export function discoverAuthors(
	data: DirectoryData,
	keyword: string,
): DirectoryIdentity[] {
	return data.identities
		.filter(
			(identity) =>
				identity.memberId === null &&
				matches(
					keyword,
					identity.name,
					identity.handle,
					identity.organization,
					identity.provider,
				),
		)
		.sort(byName);
}

export function createDirectoryEditor(
	kind: DirectoryKind,
	data: DirectoryData,
	id: string | null = null,
): DirectoryEditor | null {
	if (id && !data[kind].some((row) => row.id === id && row.archivedAt === null))
		return null;
	if (kind === "members") {
		const member = data.members.find((row) => row.id === id);
		return {
			kind,
			id,
			revision: data.revision,
			followKey: null,
			draft: {
				name: member?.name ?? "",
				avatarUrl: member?.avatarUrl ?? null,
				teamIds: [...(member?.teamIds ?? [])],
				tagIds: [...(member?.tagIds ?? [])],
				identityKeys: [...(member?.identityKeys ?? [])],
			},
		};
	}
	if (kind === "teams") {
		const team = data.teams.find((row) => row.id === id);
		return {
			kind,
			id,
			revision: data.revision,
			followKey: null,
			draft: {
				name: team?.name ?? "",
				avatarUrl: team?.avatarUrl ?? null,
				memberIds: [...(team?.memberIds ?? [])],
				tagIds: [...(team?.tagIds ?? [])],
			},
		};
	}
	const tag = data.tags.find((row) => row.id === id);
	return {
		kind,
		id,
		revision: data.revision,
		followKey: null,
		draft: { name: tag?.name ?? "", color: tag?.color ?? "#558BCE" },
	};
}
