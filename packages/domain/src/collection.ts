import { z } from "zod";
import { observationSchema, repositoryIdentitySchema } from "./monitoring.js";
import {
	collectionJobSchema,
	mergeRequirementSchema,
	projectSchema,
	projectWriteSchema,
	pullRequestSchema,
	refreshCooldownSchema,
	repositoryNameSchema,
	scopedPullIdsSchema,
} from "./workbench.js";

const count = z.number().int().nonnegative();
const leaseToken = z.uuid();
const message = z.string().max(1000);

export const refreshSettingsSchema = z
	.object({
		listCooldownSeconds: refreshCooldownSchema.optional(),
		detailCooldownSeconds: refreshCooldownSchema.optional(),
	})
	.strict()
	.refine(
		(settings) => Object.keys(settings).length > 0,
		"Provide at least one cooldown",
	);
export type RefreshSettings = z.infer<typeof refreshSettingsSchema>;
export const collectionViewSchema = z
	.object({
		viewId: z.uuid(),
		sequence: z.number().int().nonnegative(),
		visible: z.boolean(),
		refresh: z.boolean().default(false),
		pageKey: z.string().max(4096),
		pullIds: scopedPullIdsSchema,
	})
	.strict();
export type CollectionView = z.infer<typeof collectionViewSchema>;
export const knownOpenPullSchema = pullRequestSchema.pick({
	id: true,
	number: true,
	repository: true,
});
export type KnownOpenPull = z.infer<typeof knownOpenPullSchema>;

export const collectorHeartbeatSchema = z
	.object({
		state: z.enum(["ready", "auth_required", "error"]),
		message,
	})
	.strict();
export const collectorClaimSchema = z
	.object({
		job: collectionJobSchema,
		project: projectSchema,
		leaseToken,
		observation: observationSchema.optional(),
		scope: z.array(repositoryNameSchema).optional(),
		targets: z.array(pullRequestSchema).max(20).optional(),
		/** Present once a discovery's repository plan has been resolved, including an empty plan. */
		repositories: z.array(repositoryIdentitySchema).max(1000).optional(),
		knownOpenPulls: z.array(knownOpenPullSchema).optional(),
	})
	.refine(({ job, project, targets, observation }) => {
		const ids = job.pullIds;
		if (observation)
			return (
				observation.active &&
				observation.source === project.source &&
				observation.ref.provider === project.provider &&
				observation.ref.projectId === project.id &&
				observation.ref.organization.toLowerCase() ===
					project.organization.toLowerCase() &&
				observation.ref.projectKey.toLowerCase() ===
					project.projectKey.toLowerCase() &&
				ids?.length === 1 &&
				targets !== undefined &&
				targets.length <= 1 &&
				targets.every(
					(pull) =>
						ids.includes(pull.id) &&
						pull.projectId === project.id &&
						pull.repository.id.toLowerCase() ===
							observation.ref.repository.id.toLowerCase() &&
						pull.number === observation.ref.number,
				)
			);
		if (ids === undefined) return targets === undefined;
		return (
			targets !== undefined &&
			targets.length === ids.length &&
			new Set(targets.map((pull) => pull.id)).size === ids.length &&
			targets.every(
				(pull) => ids.includes(pull.id) && pull.projectId === project.id,
			)
		);
	}, "Claim targets must match the requested PRs");
export type CollectorClaim = z.infer<typeof collectorClaimSchema>;
export const collectionBatchSchema = z
	.object({
		leaseToken,
		pulls: z.array(pullRequestSchema).min(1).max(20),
	})
	.strict();
export const collectionProgressSchema = z
	.object({
		leaseToken,
		completedPulls: count,
		totalPulls: count.nullable(),
		message,
	})
	.strict();
export const collectionFinishSchema = z
	.object({
		leaseToken,
		state: z.enum(["complete", "partial"]),
		pullRequestCount: count,
		message,
		mergeRequirements: z.array(mergeRequirementSchema).max(1000).optional(),
	})
	.strict();
export const collectionFailureSchema = z
	.object({
		leaseToken,
		kind: z.enum([
			"auth_required",
			"forbidden",
			"not_found",
			"unavailable",
			"invalid_data",
		]),
		message,
	})
	.strict();

export const collectionRepositoriesSchema = z
	.object({
		leaseToken,
		repositories: z.array(repositoryIdentitySchema).max(1000),
	})
	.strict();
export const collectionPublishSchema = z
	.object({
		leaseToken,
		repositoryId: repositoryIdentitySchema.shape.id,
		state: z.enum(["complete", "partial"]),
		pullRequestCount: count,
		message,
		mergeRequirements: z.array(mergeRequirementSchema).max(1000).optional(),
	})
	.strict();
export const collectionRepositoryFailureSchema = z
	.object({
		leaseToken,
		repositoryId: repositoryIdentitySchema.shape.id,
		message,
	})
	.strict();
export const collectionDoneSchema = z.object({ leaseToken }).strict();

export function adoPullId(
	projectId: string,
	repositoryId: string,
	externalId: string,
): string {
	return `ado:${projectId}:${repositoryId}:${externalId}`;
}

export function parseAdoRepositoryUrl(value: string) {
	const url = new URL(value.trim());
	const parts = url.pathname
		.replace(/\/$/, "")
		.split("/")
		.slice(1)
		.map(decodeURIComponent);
	if (
		url.protocol !== "https:" ||
		url.host !== "dev.azure.com" ||
		url.username ||
		url.password ||
		parts.length !== 4 ||
		parts[2] !== "_git"
	) {
		throw new Error(
			"Enter an Azure DevOps repository URL: https://dev.azure.com/organization/project/_git/repository",
		);
	}
	const source = projectWriteSchema
		.pick({ organization: true, projectKey: true })
		.parse({ organization: parts[0], projectKey: parts[1] });
	return { ...source, repository: repositoryNameSchema.parse(parts[3]) };
}
