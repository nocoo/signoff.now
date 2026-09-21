import { demoWorkspace } from "@signoff/domain/demo";
import {
	makeWatchRef,
	type Observation,
	publicSource,
	referenceLinks,
} from "@signoff/domain/monitoring";
import {
	collectorQuerySchema,
	type JobQueryItem,
	pullListSchema,
	pullQuerySchema,
	repoListSchema,
} from "@signoff/domain/query";
import {
	type Project,
	type PullRequest,
	projectSchema,
	pullProgress,
	pullReadiness,
	pullRequestSchema,
	pullRequirements,
} from "@signoff/domain/workbench";

export const fixtureNow = 1_800_000_000;
const demo = demoWorkspace(fixtureNow);
export const fixtureProject = {
	...projectSchema.parse(demo.projects[0]),
	source: "cli" as const,
};
export const fixturePull = {
	...pullRequestSchema.parse(demo.pullRequests[0]),
	projectId: fixtureProject.id,
	draft: false,
	state: "open" as const,
};
export const iso = (value: number) => new Date(value * 1000).toISOString();
export function fixtureJob(
	overrides: Partial<JobQueryItem> = {},
): JobQueryItem {
	return {
		id: "job-1",
		source: "live",
		kind: "refresh",
		state: "succeeded",
		projectId: fixtureProject.id,
		projectRevision: 1,
		scope: [],
		reason: null,
		error: null,
		message: "Collected 1 PR completely",
		requestedAt: iso(fixtureNow - 30),
		startedAt: iso(fixtureNow - 20),
		updatedAt: iso(fixtureNow),
		completedAt: iso(fixtureNow),
		notBefore: iso(fixtureNow - 30),
		progress: { completed: 1, total: 1 },
		observation: { id: "watch-1", generation: 1 },
		repositories: [],
		...overrides,
	};
}
export function publicProject(project = fixtureProject as Project) {
	return {
		...project,
		key: project.projectKey,
		url: referenceLinks(makeWatchRef(project, fixturePull.repository, 1))
			.project.url,
		source: publicSource(project.source),
		createdAt: iso(project.createdAt),
		updatedAt: iso(project.updatedAt),
		lastScannedAt:
			project.lastScannedAt === null ? null : iso(project.lastScannedAt),
	};
}
export function publicPull(
	pull: PullRequest = fixturePull,
	project: Project = fixtureProject,
	observation: Observation | null = null,
) {
	const readiness = pullReadiness(pull, project);
	const ref = makeWatchRef(project, pull.repository, pull.number);
	return pullQuerySchema.parse({
		...pull,
		...referenceLinks(ref),
		project: publicProject(project),
		provider: project.provider,
		url: ref.url,
		state: pull.state === "open" && pull.draft ? "draft" : pull.state,
		author: { ...pull.author, key: "actor-key" },
		createdAt: iso(pull.createdAt),
		updatedAt: iso(pull.updatedAt),
		mergedAt: pull.mergedAt ? iso(pull.mergedAt) : null,
		publishedAt: iso(fixtureNow),
		activity: pull.activity.map((a) => ({ ...a, at: iso(a.at) })),
		observation: observation
			? {
					...observation,
					source: publicSource(observation.source),
					addedAt: iso(observation.addedAt),
					stoppedAt:
						observation.stoppedAt === null ? null : iso(observation.stoppedAt),
				}
			: null,
		freshness: {
			listObservedAt: iso(fixtureNow),
			checksObservedAt:
				pull.checksObservedAt === null
					? null
					: iso(pull.checksObservedAt ?? fixtureNow),
			checksValidity: pull.checksObservedAt === null ? "missing" : "valid",
			ageSeconds: { list: 0, checks: 0 },
			clockSkew: false,
		},
		readiness: {
			...readiness,
			ready: readiness.kind === "ready",
			primaryRequirementId: readiness.gateId ?? null,
			nextAction: readiness.action,
		},
		checks: pullProgress(pull),
		requirements: pullRequirements(pull, project),
		content: { state: pull.coverage, missing: [] },
	});
}
export function fixtureObservation(
	overrides: Partial<Observation> = {},
): Observation {
	return {
		id: "watch-1",
		source: "cli",
		ref: makeWatchRef(
			fixtureProject,
			fixturePull.repository,
			fixturePull.number,
		),
		pullId: fixturePull.id,
		generation: 1,
		active: true,
		addedAt: fixtureNow,
		stoppedAt: null,
		stopReason: null,
		...overrides,
	};
}
export function queryFixture(source: "cli" | "demo" = "cli") {
	const project = { ...fixtureProject, source };
	const envelope = {
		schemaVersion: 1,
		source: publicSource(source),
		dataRevision: "1",
		generatedAt: iso(fixtureNow),
		coverage: { state: "complete", missing: [] as string[] },
	} as const;
	const page = { limit: 20, total: 1, nextCursor: null };
	const pulls = pullListSchema.parse({
		...envelope,
		data: [publicPull(fixturePull, project)],
		page,
		metrics: {
			open: 1,
			attention: 1,
			running: 0,
			ready: 0,
			draft: 0,
			merged: 0,
			closed: 0,
		},
		authors: [
			{
				id: "actor-key",
				name: fixturePull.author.name,
				provider: project.provider,
			},
		],
	});
	const catalog = repoListSchema.parse({
		...envelope,
		page,
		projects: [publicProject(project)],
		data: [
			{
				key: "repo-key",
				provider: project.provider,
				organization: pullQuerySchema.parse(pulls.data[0]).organization,
				project: publicProject(project),
				repository: {
					...pullQuerySchema.parse(pulls.data[0]).repository,
					projectExternalId: "project-guid",
				},
				identityResolved: true,
				lastDiscoveredAt: iso(fixtureNow),
				coverage: envelope.coverage,
				counts: {
					open: 1,
					draft: 0,
					merged: 0,
					closed: 0,
					watching: 0,
					attention: 1,
					ready: 0,
					running: 0,
				},
			},
		],
	});
	const collector = collectorQuerySchema.parse({
		schemaVersion: 1,
		source: publicSource(source),
		generatedAt: iso(fixtureNow),
		connection: {
			state: "ready",
			lastSeenAt: iso(fixtureNow),
			message: "Connected",
		},
		queue: { running: 0, queued: 0, authRequired: 0 },
		watching: 0,
		pendingFirstResult: 0,
		sampleCommandsEnabled: true,
		detailCooldownSeconds: 300,
		discovery: "on_demand",
		jobs: [],
		rounds: [],
	});
	return { envelope, page, pulls, catalog, collector };
}
