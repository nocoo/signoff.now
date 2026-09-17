import {
	type ProjectWrite,
	projectSchema,
	scanRequestResultSchema,
	workbenchSchema,
} from "@signoff/domain/workbench";
import { apiFetch } from "@/lib/api";

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

export async function scanProject(id: string, revision: number) {
	return scanRequestResultSchema.parse(
		await apiFetch<unknown>(`/api/projects/${encodeURIComponent(id)}/scan`, {
			method: "POST",
			body: JSON.stringify({ revision }),
		}),
	);
}
