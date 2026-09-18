import type { RefreshSettings } from "@signoff/domain/collection";
import {
	type ProjectWrite,
	projectSchema,
	refreshQueueSchema,
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
