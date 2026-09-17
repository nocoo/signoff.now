import { z } from "zod";
import { type Project, providerSchema } from "./workbench";

export const dataSourceSchema = z.enum(["cli", "demo"]);
export type DataSource = z.infer<typeof dataSourceSchema>;
const text = z.string().trim().min(1).max(240);
const ids = z
	.array(z.string().min(1).max(1000))
	.max(64)
	.transform((values) => [...new Set(values)].sort());
const avatarUrl = z.string().url().max(2048).nullable();

/** No name/email guessing: an account belongs to one provider and organization. */
export function identityKey(
	provider: "ado" | "github",
	organization: string,
	actorId: string,
): string {
	return JSON.stringify([provider, organization.toLowerCase(), actorId]);
}

const identityPartsSchema = z.tuple([providerSchema, text, text]);
export function parseIdentityKey(
	key: string,
): ["ado" | "github", string, string] | null {
	try {
		const parts = identityPartsSchema.parse(JSON.parse(key));
		return identityKey(...parts) === key ? parts : null;
	} catch {
		return null;
	}
}

export const repositoryKey = (
	projectId: string,
	repositoryId: string,
): string => JSON.stringify([projectId, repositoryId]);

export interface DirectoryIdentity {
	key: string;
	provider: "ado" | "github";
	organization: string;
	actorId: string;
	name: string;
	handle: string | null;
	avatarUrl: string | null;
	lastSeenAt: number | null;
	memberId: string | null;
}

export interface DirectoryMember {
	id: string;
	name: string;
	avatarUrl: string | null;
	teamIds: string[];
	tagIds: string[];
	identityKeys: string[];
	archivedAt: number | null;
}

export interface DirectoryTeam {
	id: string;
	name: string;
	avatarUrl: string | null;
	memberIds: string[];
	tagIds: string[];
	archivedAt: number | null;
}

export interface DirectoryTag {
	id: string;
	name: string;
	color: string;
	archivedAt: number | null;
}

export interface RepositoryRef {
	key: string;
	projectId: string;
	id: string;
	name: string;
}

export interface DirectoryData {
	source: DataSource;
	revision: number;
	members: DirectoryMember[];
	teams: DirectoryTeam[];
	tags: DirectoryTag[];
	identities: DirectoryIdentity[];
	projects: Project[];
	repositories: RepositoryRef[];
}

export const memberDraftSchema = z
	.object({
		name: text,
		avatarUrl: avatarUrl.default(null),
		teamIds: ids.default([]),
		tagIds: ids.default([]),
		identityKeys: ids
			.refine(
				(keys) => keys.every((key) => parseIdentityKey(key) !== null),
				"Invalid account identity",
			)
			.default([]),
	})
	.strict();
export type MemberDraft = z.infer<typeof memberDraftSchema>;

export const teamDraftSchema = z
	.object({
		name: text,
		avatarUrl: avatarUrl.default(null),
		memberIds: ids.default([]),
		tagIds: ids.default([]),
	})
	.strict();
export type TeamDraft = z.infer<typeof teamDraftSchema>;

export const tagDraftSchema = z
	.object({
		name: text,
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.transform((value) => value.toUpperCase()),
	})
	.strict();
export type TagDraft = z.infer<typeof tagDraftSchema>;

const day = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const time = Date.parse(`${value}T00:00:00Z`);
		return (
			Number.isFinite(time) &&
			new Date(time).toISOString().slice(0, 10) === value
		);
	}, "Invalid date");

export const contributionFiltersSchema = z
	.object({
		source: dataSourceSchema,
		from: day.nullable().default(null),
		to: day.nullable().default(null),
		projectIds: ids.default([]),
		repositoryKeys: ids.default([]),
		contributorKeys: ids.default([]),
		teamIds: ids.default([]),
		tagIds: ids.default([]),
		audience: z.enum(["all", "followed"]).default("all"),
		includeDraft: z.boolean().default(false),
		states: z
			.array(z.enum(["open", "merged", "closed"]))
			.min(1)
			.max(3)
			.transform((values) => [...new Set(values)].sort())
			.default(["closed", "merged", "open"]),
	})
	.strict()
	.refine(({ from, to }) => {
		if (from === null || to === null) return from === null && to === null;
		const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
		return days >= 0 && days < 366;
	}, "Choose both dates, ordered within a 366-day period");
export type ContributionFilters = z.infer<typeof contributionFiltersSchema>;

export function defaultContributionFilters(
	source: DataSource,
	nowMs = Date.now(),
): ContributionFilters {
	const to = new Date(nowMs).toISOString().slice(0, 10);
	const from = new Date(Date.parse(to) - 29 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	return contributionFiltersSchema.parse({ source, from, to });
}

export const contributionModuleSchema = z.enum([
	"overview",
	"trend",
	"members",
	"repositories",
]);
export type ContributionModule = z.infer<typeof contributionModuleSchema>;

/** Draft is a separate, mutually exclusive category; the four categories sum to total. */
export interface PullCounts {
	total: number;
	open: number;
	merged: number;
	closed: number;
	draft: number;
}
export interface ContributionTotals extends PullCounts {
	contributors: number;
	repositories: number;
	lastCollectedAt: number | null;
}
export interface DailyContribution extends PullCounts {
	day: string;
}
export interface MemberContribution extends PullCounts {
	key: string;
	memberId: string | null;
	name: string;
	avatarUrl: string | null;
	teamIds: string[];
	lastCollectedAt: number | null;
}
export interface RepositoryContribution extends RepositoryRef, PullCounts {
	contributors: number;
	lastCollectedAt: number | null;
}
export interface ContributionSnapshot {
	module: ContributionModule;
	filters: ContributionFilters;
	calculatedAt: number;
	coverage: "observed" | "sample";
	totals: ContributionTotals;
	trend: DailyContribution[];
	members: MemberContribution[];
	repositories: RepositoryContribution[];
}
