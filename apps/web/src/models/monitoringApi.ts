import {
	type Observation,
	publicSource,
	storageSource,
} from "@signoff/domain/monitoring";
import {
	batchCommandSchema,
	collectorQuerySchema,
	commandReceiptSchema,
	observationListSchema,
	type PullQueryItem,
	pullDetailSchema,
	pullListSchema,
	type RepositoryQueryItem,
	repoListSchema,
} from "@signoff/domain/query";
import { projectSchema, pullRequestSchema } from "@signoff/domain/workbench";
import { ApiError, apiFetch } from "@/lib/api";
import type { PullFilter, PullRow } from "./workbench";

export function seconds(value: string): number;
export function seconds(value: string | null | undefined): number | null;
export function seconds(value: string | null | undefined): number | null {
	return value === null || value === undefined
		? null
		: Date.parse(value) / 1000;
}
export function queryProject(project: RepositoryQueryItem["project"]) {
	return projectSchema.parse({
		...project,
		source: storageSource(project.source),
		createdAt: seconds(project.createdAt),
		updatedAt: seconds(project.updatedAt),
		lastScannedAt: seconds(project.lastScannedAt),
	});
}
export function queryRow(value: PullQueryItem): PullRow {
	const summary = seconds(value.freshness.listObservedAt);
	return {
		project: queryProject(value.project),
		pull: pullRequestSchema.parse({
			...value,
			state: value.state === "draft" ? "open" : value.state,
			projectId: value.project.id,
			createdAt: seconds(value.createdAt),
			updatedAt: seconds(value.updatedAt),
			mergedAt: seconds(value.mergedAt),
			observedAt: summary === null ? null : Math.floor(summary),
			summaryObservedAt: summary ?? undefined,
			checksObservedAt: seconds(value.freshness.checksObservedAt),
			activity: value.activity.map((item) => ({
				...item,
				at: seconds(item.at),
			})),
		}),
		readiness: {
			...value.readiness,
			action: value.readiness.nextAction,
			issues: value.readiness.issues as PullRow["readiness"]["issues"],
			gateId: value.readiness.primaryRequirementId ?? undefined,
		},
		progress: value.checks,
		observation: value.observation
			? {
					...value.observation,
					source: storageSource(value.observation.source),
					addedAt: seconds(value.observation.addedAt),
					stoppedAt: seconds(value.observation.stoppedAt),
				}
			: null,
	};
}
function init(signal: AbortSignal) {
	return { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) };
}
export function pullQueryParams(filter: PullFilter, page: number) {
	const params = new URLSearchParams({
		source: publicSource(filter.source),
		q: filter.query,
		org: filter.organization,
		projectId: filter.projectId,
		state: filter.state,
		draft: filter.draft,
		status: filter.status,
		sort: filter.sort,
		direction: filter.sortDirection,
		limit: "20",
		page: String(page),
	});
	params.set(
		filter.repository.startsWith("https://") ? "repo" : "repositoryId",
		filter.repository,
	);
	for (const author of filter.authors) params.append("author", author);
	if (filter.watching !== "all")
		params.set("watching", String(filter.watching === "watching"));
	return params.toString();
}
export async function loadPulls(query: string, signal: AbortSignal) {
	return pullListSchema.parse(
		await apiFetch(`/api/query/v1/prs?${query}`, init(signal)),
	);
}
export async function loadPull(
	source: PullFilter["source"],
	id: string,
	signal: AbortSignal,
) {
	return pullDetailSchema.parse(
		await apiFetch(
			`/api/query/v1/prs/${encodeURIComponent(id)}?source=${publicSource(source)}`,
			init(signal),
		),
	);
}
export async function lookupPull(
	source: PullFilter["source"],
	reference: { repositoryUrl: string; number: number },
	signal: AbortSignal,
) {
	const params = new URLSearchParams({
		source: publicSource(source),
		repositoryUrl: reference.repositoryUrl,
		number: String(reference.number),
	});
	return pullDetailSchema.parse(
		await apiFetch(`/api/query/v1/prs/lookup?${params}`, init(signal)),
	);
}
export async function loadCollector(
	source: PullFilter["source"],
	signal: AbortSignal,
) {
	return collectorQuerySchema.parse(
		await apiFetch(
			`/api/query/v1/collector?source=${publicSource(source)}`,
			init(signal),
		),
	);
}
export async function loadPending(
	source: PullFilter["source"],
	signal: AbortSignal,
	scope?: Pick<PullFilter, "organization" | "projectId" | "repository">,
	page = 1,
) {
	const params = new URLSearchParams({
		source: publicSource(source),
		pending: "true",
		limit: "20",
	});
	if (page > 1) params.set("page", String(page));
	if (scope?.organization) params.set("org", scope.organization);
	if (scope?.projectId) params.set("projectId", scope.projectId);
	if (scope?.repository)
		params.set(
			scope.repository.startsWith("https://") ? "repo" : "repositoryId",
			scope.repository,
		);
	return observationListSchema.parse(
		await apiFetch(`/api/query/v1/observations?${params}`, init(signal)),
	);
}
export async function loadCatalog(
	source: PullFilter["source"],
	signal: AbortSignal,
	scope?: Pick<PullFilter, "repository" | "projectId">,
) {
	const params = new URLSearchParams({
		source: publicSource(source),
		limit: "200",
	});
	if (scope?.repository) params.set("repo", scope.repository);
	if (scope?.projectId) params.set("projectId", scope.projectId);
	for (let attempt = 0; ; attempt++) {
		try {
			const first = repoListSchema.parse(
				await apiFetch(`/api/query/v1/repos?${params}`, init(signal)),
			);
			let cursor = first.page.nextCursor;
			const seen = new Set<string>();
			while (cursor) {
				if (seen.has(cursor))
					throw new Error("Repository query returned a repeated cursor");
				seen.add(cursor);
				const page = repoListSchema.parse(
					await apiFetch(
						`/api/query/v1/repos?${params}&cursor=${encodeURIComponent(cursor)}`,
						init(signal),
					),
				);
				first.data.push(...page.data);
				cursor = page.page.nextCursor;
			}
			return first;
		} catch (error) {
			if (
				attempt === 2 ||
				!(error instanceof ApiError) ||
				(error.body as { error?: { code?: string } })?.error?.code !==
					"SNAPSHOT_CHANGED"
			)
				throw error;
		}
	}
}
const command = (path: string, body: object) =>
	apiFetch(`/api/commands/v1/${path}`, {
		method: "POST",
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15000),
	});
export async function addWatches(source: PullFilter["source"], ids: string[]) {
	return batchCommandSchema.parse(
		await command("observations", {
			source: publicSource(source),
			refs: ids.map((pullId) => ({ pullId })),
		}),
	);
}
export async function removeWatches(
	source: PullFilter["source"],
	items: Pick<Observation, "id" | "generation">[],
) {
	return batchCommandSchema.parse(
		await command("observations/remove", {
			source: publicSource(source),
			items: items.map(({ id, generation }) => ({ id, generation })),
		}),
	);
}
export async function discover(
	source: PullFilter["source"],
	target: { projectId: string } | { repositoryUrl: string },
) {
	return commandReceiptSchema.parse(
		await command("discover", { source: publicSource(source), ...target }),
	);
}
export async function refreshWatches(
	source: PullFilter["source"],
	pullId?: string,
) {
	return commandReceiptSchema.parse(
		await command("refresh", {
			source: publicSource(source),
			target: pullId ? { pullId } : { all: true },
		}),
	);
}
