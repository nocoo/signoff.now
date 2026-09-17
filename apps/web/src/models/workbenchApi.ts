import type {
	CollectionView,
	RefreshSettings,
} from "@signoff/domain/collection";
import {
	type ProjectWrite,
	projectSchema,
	type ReadinessRule,
	refreshQueueSchema,
	scanRequestResultSchema,
	workbenchSchema,
} from "@signoff/domain/workbench";
import { apiFetch } from "@/lib/api";

export async function patchRefreshSettings(settings: RefreshSettings) {
	return refreshQueueSchema.array().parse(
		await apiFetch<unknown>("/api/collection/settings", {
			method: "PATCH",
			body: JSON.stringify(settings),
		}),
	);
}

export async function updateCollectionView(view: CollectionView) {
	return refreshQueueSchema.array().parse(
		await apiFetch<unknown>("/api/collection/view", {
			method: "POST",
			body: JSON.stringify(view),
			keepalive: !view.visible,
			signal: AbortSignal.timeout(15_000),
		}),
	);
}

export async function loadWorkbench() {
	return workbenchSchema.parse(await apiFetch<unknown>("/api/workbench"));
}

export async function createProject(body: ProjectWrite) {
	return projectSchema.parse(
		await apiFetch<unknown>("/api/projects", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
}

export async function patchProject(
	id: string,
	body: Partial<ProjectWrite> & { revision: number },
) {
	return projectSchema.parse(
		await apiFetch<unknown>(`/api/projects/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	);
}

export async function deleteProject(id: string, revision: number) {
	await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
		method: "DELETE",
		body: JSON.stringify({ revision }),
	});
}

export async function patchReadiness(
	id: string,
	revision: number,
	rules: ReadinessRule[],
) {
	return projectSchema.parse(
		await apiFetch<unknown>(
			`/api/projects/${encodeURIComponent(id)}/readiness`,
			{
				method: "PATCH",
				body: JSON.stringify({ revision, rules }),
			},
		),
	);
}

export async function scanProject(
	id: string,
	revision: number,
	pullIds?: string[],
) {
	return scanRequestResultSchema.parse(
		await apiFetch<unknown>(`/api/projects/${encodeURIComponent(id)}/scan`, {
			method: "POST",
			body: JSON.stringify({ revision, pullIds }),
		}),
	);
}
