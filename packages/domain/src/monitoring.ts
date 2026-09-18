import { z } from "zod";
import {
	type Project,
	type PullRequest,
	projectUrl,
	providerSchema,
	repositoryNameSchema,
	repositoryUrl,
} from "./workbench.js";

export const dataSourceSchema = z.enum(["cli", "demo"]);
export type DataSource = z.infer<typeof dataSourceSchema>;
export const querySourceSchema = z.enum(["live", "sample"]);
export type QuerySource = z.infer<typeof querySourceSchema>;
export const storageSource = (source: QuerySource): DataSource =>
	source === "live" ? "cli" : "demo";
export const publicSource = (source: DataSource): QuerySource =>
	source === "cli" ? "live" : "sample";

const identity = z.string().trim().min(1).max(240);
export const repositoryIdentitySchema = z.object({
	id: identity,
	name: repositoryNameSchema,
	projectExternalId: identity.optional(),
});
export type RepositoryIdentity = z.infer<typeof repositoryIdentitySchema>;
export const watchRefSchema = z.object({
	provider: providerSchema,
	organization: identity,
	projectId: identity,
	projectKey: identity,
	repository: repositoryIdentitySchema,
	number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	url: z.string().url().max(4096),
});
export type WatchRef = z.infer<typeof watchRefSchema>;
export const observationSchema = z.object({
	id: identity,
	source: dataSourceSchema,
	ref: watchRefSchema,
	pullId: identity.nullable(),
	generation: z.number().int().positive(),
	active: z.boolean(),
	addedAt: z.number().int().nonnegative(),
	stoppedAt: z.number().int().nonnegative().nullable(),
	stopReason: z
		.enum([
			"manual",
			"completed",
			"abandoned",
			"project_deleted",
			"scope_changed",
		])
		.nullable(),
});
export type Observation = z.infer<typeof observationSchema>;

export type RepositoryReference = {
	provider: "ado" | "github";
	organization: string;
	projectKey: string;
	repository: string;
	repositoryUrl: string;
};

function referenceParts(value: string) {
	const text = value.trim();
	const url = new URL(text);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		url.search ||
		url.hash ||
		!["dev.azure.com", "github.com"].includes(url.hostname) ||
		/(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(text) ||
		text.includes("\\")
	)
		throw new TypeError(
			"Use a complete HTTPS ADO or GitHub URL without credentials, query or fragment",
		);
	const parts = url.pathname
		.replace(/\/$/, "")
		.split("/")
		.slice(1)
		.map((part) => repositoryNameSchema.parse(decodeURIComponent(part)));
	return { url, parts };
}

export function parseRepositoryReference(value: string): RepositoryReference {
	const { url, parts } = referenceParts(value);
	const ado = url.hostname === "dev.azure.com";
	if (
		ado
			? parts.length !== 4 || parts[2]?.toLowerCase() !== "_git"
			: parts.length !== 2
	)
		throw new TypeError(
			"Use a repository URL including its organization, project and repository",
		);
	const organization = ado
		? repositoryNameSchema.parse(parts[0])
		: "github.com";
	const projectKey = repositoryNameSchema.parse(parts[ado ? 1 : 0]);
	const repository = repositoryNameSchema.parse(parts[ado ? 3 : 1]);
	const canonicalUrl = ado
		? `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectKey)}/_git/${encodeURIComponent(repository)}`
		: `https://github.com/${encodeURIComponent(projectKey)}/${encodeURIComponent(repository)}`;
	return {
		provider: ado ? "ado" : "github",
		organization,
		projectKey,
		repository,
		repositoryUrl: canonicalUrl,
	};
}

export function parsePullReference(
	value: string,
): RepositoryReference & { number: number } {
	const { url, parts } = referenceParts(value);
	const ado = url.hostname === "dev.azure.com";
	const number = parts[parts.length - 1] ?? "";
	if (
		parts.length !== (ado ? 6 : 4) ||
		parts[parts.length - 2]?.toLowerCase() !== (ado ? "pullrequest" : "pull") ||
		!/^[1-9]\d*$/.test(number) ||
		!Number.isSafeInteger(Number(number))
	)
		throw new TypeError("Use a complete PR URL with a positive PR number");
	return {
		...parseRepositoryReference(
			`${url.origin}/${parts.slice(0, -2).map(encodeURIComponent).join("/")}`,
		),
		number: Number(number),
	};
}

export function makeWatchRef(
	project: Project,
	repository: RepositoryIdentity,
	number: number,
): WatchRef {
	return watchRefSchema.parse({
		provider: project.provider,
		organization: project.organization,
		projectId: project.id,
		projectKey: project.projectKey,
		repository,
		number,
		url: `${repositoryUrl(project, repository.name)}/${project.provider === "ado" ? "pullrequest" : "pull"}/${number}`,
	});
}

/** Names and URLs can change; the provider repository identity cannot. */
export function canonicalObservationKey(
	source: DataSource,
	ref: WatchRef,
): string {
	return JSON.stringify([
		source,
		ref.provider,
		ref.organization.toLowerCase(),
		ref.projectKey.toLowerCase(),
		ref.repository.id.toLowerCase(),
		ref.number,
	]);
}

export function referenceLinks(ref: WatchRef) {
	const project = {
		provider: ref.provider,
		organization: ref.organization,
		projectKey: ref.projectKey,
	};
	return {
		organization: {
			key: ref.organization,
			url:
				ref.provider === "ado"
					? `https://dev.azure.com/${encodeURIComponent(ref.organization)}`
					: "https://github.com",
		},
		project: {
			id: ref.projectId,
			key: ref.projectKey,
			url: projectUrl(project),
		},
		repository: {
			...ref.repository,
			url: repositoryUrl(project, ref.repository.name),
		},
	};
}

/** Discovery updates base facts; checks remain tied to the exact head and target. */
export function mergeDiscoveredPull(
	fresh: PullRequest,
	cached?: PullRequest,
): PullRequest {
	if (!cached) return fresh;
	if (
		!fresh.headSha ||
		fresh.headSha !== cached.headSha ||
		!fresh.targetSha ||
		fresh.targetSha !== cached.targetSha ||
		fresh.targetBranch !== cached.targetBranch
	)
		return { ...fresh, checksObservedAt: null, checksInvalidated: true };
	const oldReviewers = new Map(
		cached.reviewers.map((reviewer) => [reviewer.id, reviewer]),
	);
	const authorEligible =
		cached.authorCountsTowardApproval ??
		oldReviewers.get(fresh.author.id)?.countsTowardApproval ??
		false;
	return {
		...fresh,
		updatedAt: Math.max(fresh.updatedAt, cached.updatedAt),
		policies: cached.policies,
		builds: cached.builds,
		reviewers: fresh.reviewers.map((reviewer) => ({
			...reviewer,
			countsTowardApproval:
				reviewer.id === fresh.author.id
					? authorEligible
					: (oldReviewers.get(reviewer.id)?.countsTowardApproval ??
						reviewer.countsTowardApproval ??
						true),
		})),
		authorCountsTowardApproval: authorEligible,
		requiredApprovals: cached.requiredApprovals,
		allowDownvotes: cached.allowDownvotes,
		coverage: cached.coverage,
		collectionIssues: cached.collectionIssues,
		filesChanged: cached.filesChanged,
		additions: cached.additions,
		deletions: cached.deletions,
		comments: cached.comments,
		checksObservedAt:
			cached.checksObservedAt === undefined
				? cached.observedAt
				: cached.checksObservedAt,
		checksInvalidated: cached.checksInvalidated,
	};
}
