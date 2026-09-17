import { z } from "zod";
import {
	collectionJobSchema,
	projectSchema,
	projectWriteSchema,
	pullRequestSchema,
	repositoryNameSchema,
} from "./workbench.js";

const count = z.number().int().nonnegative();
const leaseToken = z.uuid();
const message = z.string().max(1000);

export const collectorHeartbeatSchema = z
	.object({
		state: z.enum(["ready", "auth_required", "error"]),
		message,
	})
	.strict();
export const collectorClaimSchema = z.object({
	job: collectionJobSchema,
	project: projectSchema,
	leaseToken,
});
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
