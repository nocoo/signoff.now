import { z } from "zod";
import {
	observationSchema,
	querySourceSchema,
	watchRefSchema,
} from "./monitoring.js";
import {
	checkStateSchema,
	mergeRequirementSchema,
	projectSchema,
	pullRequestSchema,
	readinessColorSchema,
	readinessKindSchema,
	stateMachineSchema,
} from "./workbench.js";

const iso = z.iso.datetime();
const nullableIso = iso.nullable();
export const projectQuerySchema = projectSchema.extend({
	source: querySourceSchema,
	createdAt: iso,
	updatedAt: iso,
	lastScannedAt: nullableIso,
	key: z.string(),
	url: z.url(),
});
export const observationQuerySchema = observationSchema.extend({
	source: querySourceSchema,
	addedAt: iso,
	stoppedAt: nullableIso,
});
export const coverageSchema = z.object({
	state: z.enum(["complete", "partial", "not_collected"]),
	missing: z.array(z.string()),
});
export const pullQuerySchema = pullRequestSchema
	.omit({
		projectId: true,
		observedAt: true,
		checksObservedAt: true,
		summaryObservedAt: true,
		activity: true,
	})
	.extend({
		provider: z.enum(["ado", "github"]),
		organization: z.object({ key: z.string(), url: z.url() }),
		project: projectQuerySchema,
		repository: z.object({ id: z.string(), name: z.string(), url: z.url() }),
		url: z.url(),
		createdAt: iso,
		updatedAt: iso,
		mergedAt: nullableIso.optional(),
		publishedAt: nullableIso,
		state: z.enum(["open", "draft", "merged", "closed"]),
		author: pullRequestSchema.shape.author.extend({ key: z.string() }),
		activity: z.array(
			z.object({
				id: z.string(),
				at: iso,
				actor: z.string(),
				title: z.string(),
				detail: z.string(),
			}),
		),
		observation: observationQuerySchema.nullable(),
		freshness: z.object({
			listObservedAt: nullableIso,
			checksObservedAt: nullableIso,
			checksValidity: z.enum(["valid", "invalidated", "missing"]),
			ageSeconds: z.object({
				list: z.number().nullable(),
				checks: z.number().nullable(),
			}),
			clockSkew: z.boolean(),
		}),
		readiness: z.object({
			stateId: z.string().optional(),
			machineRevision: z.number().int().positive().optional(),
			matchedRuleId: z.string().optional(),
			kind: readinessKindSchema,
			ready: z.boolean(),
			label: z.string(),
			primaryRequirementId: z.string().nullable(),
			nextAction: z.string(),
			owner: z.string(),
			issues: z.array(
				z.object({
					kind: z.string(),
					label: z.string(),
					action: z.string(),
					owner: z.string(),
					gateId: z.string().optional(),
					gateName: z.string().optional(),
					reason: z.literal("build_expired").optional(),
					color: readinessColorSchema.optional(),
				}),
			),
			rank: z.number().optional(),
			color: z
				.enum(["green", "yellow", "orange", "blue", "red", "purple", "gray"])
				.optional(),
		}),
		checks: z.object({
			checksPassed: z.number(),
			checksTotal: z.number(),
			stagesPassed: z.number(),
			stagesTotal: z.number(),
			optionalFailures: z.number(),
		}),
		requirements: z.array(
			mergeRequirementSchema.extend({
				required: z.boolean(),
				state: checkStateSchema,
				label: z.string(),
				color: readinessColorSchema,
				links: z.array(z.url()),
			}),
		),
		content: coverageSchema,
	});
export type PullQueryItem = z.infer<typeof pullQuerySchema>;

const machineTraceSchema = z.object({
	ruleId: z.string(),
	stateId: z.string(),
	matched: z.boolean(),
	selected: z.boolean(),
	results: z.array(z.boolean()),
	guard: z.string().optional(),
});
const machineEvaluationSchema = z.object({
	id: z.string(),
	number: z.number(),
	title: z.string(),
	repositoryId: z.string(),
	lifecycle: z.enum(["open", "merged", "closed"]),
	watched: z.boolean(),
	summaryObservedAt: z.number(),
	checksObservedAt: z.number().nullable(),
	readiness: pullQuerySchema.shape.readiness,
	requirements: pullQuerySchema.shape.requirements,
	trace: z.array(machineTraceSchema),
});
export const machinePageSchema = z.object({
	project: projectSchema,
	repositoryId: z.string().nullable(),
	repositories: z.array(z.object({ id: z.string(), name: z.string() })),
	config: stateMachineSchema,
	revision: z.number(),
	inherited: z.boolean(),
	configured: z.boolean(),
	dataRevision: z.string(),
	total: z.number(),
	evaluatedCount: z.number(),
	truncated: z.boolean(),
	catalog: z.array(mergeRequirementSchema),
	evaluations: z.array(machineEvaluationSchema),
	selectedPull: pullRequestSchema.nullable(),
	history: z.array(z.object({ revision: z.number(), createdAt: z.number() })),
	transitions: z.array(
		z.object({
			id: z.number(),
			at: z.number(),
			cause: z.literal("observation"),
			ruleRevision: z.number(),
			from: pullQuerySchema.shape.readiness.nullable(),
			to: pullQuerySchema.shape.readiness,
		}),
	),
});
export type MachinePage = z.infer<typeof machinePageSchema>;
export const machinePullPageSchema = z.object({
	data: z.array(
		machineEvaluationSchema.pick({
			id: true,
			number: true,
			title: true,
			watched: true,
		}),
	),
	nextCursor: z.string().nullable(),
});
export type MachinePullOption = z.infer<
	typeof machinePullPageSchema
>["data"][number];
export const machinePreviewSchema = z.object({
	revision: z.number(),
	dataRevision: z.string(),
	evaluatedCount: z.number(),
	total: z.number(),
	truncated: z.boolean(),
	changed: z.number(),
	changes: z.array(
		z.object({
			id: z.string(),
			number: z.number(),
			title: z.string(),
			before: pullQuerySchema.shape.readiness,
			after: pullQuerySchema.shape.readiness,
		}),
	),
	evaluations: z.array(machineEvaluationSchema),
});
export type MachinePreview = z.infer<typeof machinePreviewSchema>;
export const machineVersionSchema = z.object({
	revision: z.number().int().positive(),
	config: stateMachineSchema.nullable(),
});
export const machineWriteSchema = z
	.object({
		revision: z.number().int().positive(),
		repositoryId: z.string().min(1).max(240).nullable(),
		config: stateMachineSchema.nullable(),
	})
	.strict();
export const repositoryQuerySchema = z.object({
	key: z.string(),
	provider: z.enum(["ado", "github"]),
	organization: z.object({ key: z.string(), url: z.url() }),
	project: projectQuerySchema,
	repository: z.object({
		id: z.string().nullable(),
		name: z.string(),
		url: z.url(),
		projectExternalId: z.string().nullable(),
	}),
	identityResolved: z.boolean(),
	lastDiscoveredAt: nullableIso,
	coverage: coverageSchema,
	counts: z.object({
		open: z.number(),
		draft: z.number(),
		merged: z.number(),
		closed: z.number(),
		watching: z.number(),
		attention: z.number(),
		running: z.number(),
		ready: z.number(),
	}),
});
export type RepositoryQueryItem = z.infer<typeof repositoryQuerySchema>;
export const observationItemSchema = observationQuerySchema.extend({
	pull: pullQuerySchema.nullable(),
});
export type ObservationQueryItem = z.infer<typeof observationItemSchema>;
export const pageSchema = z.object({
	limit: z.number().int().positive(),
	total: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});
export const envelopeSchema = z.object({
	schemaVersion: z.literal(1),
	source: querySourceSchema,
	dataRevision: z.string(),
	generatedAt: iso,
	coverage: coverageSchema,
});
export const pullListSchema = envelopeSchema.extend({
	data: z.array(pullQuerySchema),
	page: pageSchema,
	metrics: z.object({
		open: z.number(),
		attention: z.number(),
		running: z.number(),
		ready: z.number(),
		draft: z.number(),
		merged: z.number(),
		closed: z.number(),
	}),
	authors: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			provider: z.enum(["ado", "github"]),
		}),
	),
});
export const pullDetailSchema = envelopeSchema.extend({
	data: pullQuerySchema,
});
export const repoListSchema = envelopeSchema.extend({
	data: z.array(repositoryQuerySchema),
	projects: z.array(projectQuerySchema),
	page: pageSchema,
});
export const observationListSchema = envelopeSchema.extend({
	data: z.array(observationItemSchema),
	page: pageSchema,
});
export const observationDetailSchema = envelopeSchema.extend({
	data: observationItemSchema,
});

export const jobQuerySchema = z.object({
	id: z.string(),
	target: watchRefSchema.nullable().optional(),
	source: querySourceSchema,
	kind: z.enum(["discover", "refresh"]),
	lane: z.enum(["checks", "status"]).optional(),
	state: z.enum([
		"queued",
		"running",
		"auth_required",
		"succeeded",
		"partial",
		"failed",
		"canceled",
	]),
	projectId: z.string(),
	projectRevision: z.number(),
	scope: z.array(z.string()),
	reason: z.string().nullable(),
	error: z.string().nullable(),
	message: z.string(),
	requestedAt: iso,
	startedAt: nullableIso,
	updatedAt: iso,
	completedAt: nullableIso,
	notBefore: iso,
	progress: z.object({ completed: z.number(), total: z.number().nullable() }),
	observation: z.object({ id: z.string(), generation: z.number() }).nullable(),
	repositories: z.array(
		z.object({
			repository: z.object({ id: z.string(), name: z.string() }),
			state: z.enum(["queued", "running", "succeeded", "failed", "canceled"]),
			pullCount: z.number().nullable(),
			error: z.string().nullable(),
		}),
	),
});
export type JobQueryItem = z.infer<typeof jobQuerySchema>;
export const jobHistoryFiltersSchema = z.object({
	lane: z.enum(["all", "checks", "status", "discover"]).default("all"),
	outcome: z.enum(["all", "issues"]).default("all"),
	cursor: z.string().max(4096).optional(),
});
export type JobHistoryFilters = z.infer<typeof jobHistoryFiltersSchema>;
export const jobHistoryItemSchema = jobQuerySchema.extend({
	projectName: z.string(),
	target: watchRefSchema.nullable(),
});
export type JobHistoryItem = z.infer<typeof jobHistoryItemSchema>;
export const jobHistorySchema = z.object({
	data: z.array(jobHistoryItemSchema),
	nextCursor: z.string().nullable(),
});
export const collectorQuerySchema = z.object({
	schemaVersion: z.literal(1),
	source: querySourceSchema,
	// Older local Workers may omit this; clients retain periodic cache reads.
	dataRevision: z.string().min(1).optional(),
	generatedAt: iso,
	connection: z.object({
		state: z.enum(["ready", "offline", "auth_required", "error"]),
		lastSeenAt: nullableIso,
		message: z.string(),
	}),
	queue: z.object({
		running: z.number(),
		queued: z.number(),
		authRequired: z.number(),
	}),
	watching: z.number(),
	pendingFirstResult: z.number(),
	sampleCommandsEnabled: z.boolean().default(false),
	detailCooldownSeconds: z.number(),
	statusCooldownSeconds: z.number().optional(),
	scheduling: z
		.object({
			strategy: z.literal("per_pr"),
			checksConcurrency: z.number(),
			statusConcurrency: z.number(),
			nextCheckDueAt: nullableIso,
			overdueChecks: z.number(),
			oldestChecksAgeSeconds: z.number().nullable(),
			oldestSummaryAgeSeconds: z.number().nullable(),
			missingChecks: z.number(),
		})
		.optional(),
	discovery: z.literal("on_demand"),
	jobs: z.array(jobQuerySchema),
	rounds: z.array(
		z.object({
			projectId: z.string(),
			roundId: z.string().nullable(),
			lastCompletedAt: nullableIso,
			nextDueAt: nullableIso,
		}),
	),
});

export const jobReceiptSchema = z.object({
	id: z.string(),
	kind: z.enum(["discover", "refresh"]),
	state: jobQuerySchema.shape.state,
	coalesced: z.boolean(),
	notBefore: iso,
});
export const commandReceiptSchema = z.object({
	jobs: z.array(jobReceiptSchema),
	message: z.string().optional(),
});
export const commandItemSchema = z.object({
	status: z.enum([
		"added",
		"already_observed",
		"rejected",
		"removed",
		"already_stopped",
		"conflict",
		"not_found",
	]),
	observation: observationQuerySchema.nullable().optional(),
	job: jobReceiptSchema.nullable().optional(),
	error: z
		.object({ code: z.string(), message: z.string(), retryable: z.boolean() })
		.optional(),
});
export const batchCommandSchema = z.object({
	results: z.array(commandItemSchema),
});
