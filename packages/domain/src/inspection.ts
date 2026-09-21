import { z } from "zod";
import { observationSchema } from "./monitoring.js";
import { checkStateSchema, policyScopeSchema } from "./workbench.js";

const timestamp = z.iso.datetime().nullable();
const text = z.string().nullable();
const flag = z.boolean().nullable();
const identity = z.object({ id: z.string(), name: z.string() });
const attempt = z
	.object({
		kind: z.enum(["list", "details"]),
		state: z.string(),
		updatedAt: timestamp,
		completedAt: timestamp,
		error: text,
	})
	.nullable();
const quality = z.object({
	observedAt: timestamp,
	coverage: z.enum(["complete", "partial", "not_collected"]),
	missing: z.array(z.string()),
	lastAttempt: attempt,
});
const execution = z.object({
	state: checkStateSchema,
	providerStatus: text,
	providerResult: text,
	message: text,
	updatedAt: timestamp,
	startedAt: timestamp,
	completedAt: timestamp,
});
const match = z.object({
	actualSha: text,
	expectedSha: text,
	status: z.enum(["match", "mismatch", "unknown"]),
});
export const inspectionSchema = z.object({
	watch: z.object({
		id: z.string(),
		generation: z.number().int(),
		active: z.boolean(),
		addedAt: timestamp,
		stoppedAt: timestamp,
		stopReason: observationSchema.shape.stopReason,
	}),
	pr: z.object({
		id: text,
		number: z.number().int(),
		title: text,
		url: z.url(),
		provider: z.enum(["ado", "github"]),
		organization: z.string(),
		project: z.object({
			signoffId: z.string(),
			providerId: text,
			name: z.string(),
		}),
		repository: identity,
		author: identity.nullable(),
		lifecycle: z.enum(["open", "merged", "closed"]).nullable(),
		draft: flag,
		providerStatus: text,
		providerMergeStatus: text,
		sourceBranch: text,
		targetBranch: text,
		headSha: text,
		targetSha: text,
		targetShaSource: z.enum(["ado_lastMergeTargetCommit", "unknown"]),
		mergeSha: text,
		mergeability: z.enum(["clear", "conflicts", "unknown"]),
		createdAt: timestamp,
		collection: quality,
	}),
	readiness: z.object({
		state: z
			.enum([
				"conflict",
				"skipped",
				"attention",
				"warning",
				"running",
				"ready",
				"waiting",
			])
			.nullable(),
		source: z.enum(["jev", "provider", "target_branch"]).nullable(),
		evaluatedAt: timestamp,
		isCurrent: z.boolean(),
		update: z.object({
			state: z.enum([
				"idle",
				"scheduled",
				"evaluating",
				"blocked",
				"error",
				"stopped",
			]),
			reason: z.enum(["awaiting_collection", "unwatched"]).nullable(),
			notBefore: timestamp,
			error: text,
		}),
	}),
	nextAction: z
		.object({
			code: z.enum([
				"resolve_conflict",
				"inspect_pr",
				"observe",
				"wait_ci",
				"verify_merge",
				"wait_review",
				"none",
			]),
			text: z.string(),
			evidenceRefs: z.array(z.string()),
			url: z.url(),
		})
		.nullable(),
	checks: quality.extend({
		validity: z.enum(["valid", "invalidated", "missing"]),
		items: z.array(
			z.object({
				ref: z.string(),
				id: z.string(),
				code: text,
				name: z.string(),
				kind: text,
				state: checkStateSchema,
				providerStatus: text,
				required: flag,
				enabled: flag,
				applicable: flag,
				isExpired: flag,
				buildIsNotCurrent: flag,
				evaluationId: text,
				configurationId: text,
				configurationRevision: z.number().nullable(),
				buildId: text,
				definitionId: text,
				message: text,
				url: z.url(),
				updatedAt: timestamp,
				startedAt: timestamp,
				completedAt: timestamp,
				validDurationMinutes: z.number().nullable(),
				scope: z.array(policyScopeSchema).nullable(),
				reviewRule: z
					.object({
						minimumApproverCount: z.number().nullable(),
						creatorVoteCounts: flag,
						allowDownvotes: flag,
						requiredReviewerIds: z.array(z.string()).nullable(),
						filenamePatterns: z.array(z.string()).nullable(),
					})
					.nullable(),
			}),
		),
	}),
	builds: z.array(
		identity.extend({
			ref: z.string(),
			definitionId: text,
			number: z.number(),
			required: z.boolean(),
			sourceSha: text,
			sourceBranch: text,
			url: z.url(),
			headMatch: match,
			mergeMatch: match,
			checkRefs: z.array(z.string()),
			observedAt: timestamp,
			queuedAt: timestamp,
			...execution.shape,
			stages: z.array(
				identity.extend({
					ref: z.string(),
					identifier: text,
					recordType: text,
					attempt: z.number().nullable(),
					required: z.boolean(),
					requiredSource: z.literal("derived"),
					...execution.shape,
				}),
			),
		}),
	),
	reviews: z.object({
		observedAt: timestamp,
		individualApproved: z.number().int(),
		groupApproved: z.number().int(),
		unclassifiedApproved: z.number().int(),
		requirementsSource: z.literal("checks"),
		reviewers: z.array(
			identity.extend({
				isGroup: flag,
				required: z.boolean(),
				vote: z.string(),
				providerVote: z.number().nullable(),
				hasDeclined: flag,
				countsTowardApproval: flag,
				approvalRevision: text,
			}),
		),
	}),
});
export type Inspection = z.infer<typeof inspectionSchema>;
