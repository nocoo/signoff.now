import { apiFetch } from "@/lib/api";
import {
	type Developer,
	parseDeveloper,
	parseRepo,
	parseTag,
	parseTeam,
	type Repo,
	type Tag,
	type Team,
} from "./entities";

export async function listDevelopers(
	includeArchived = false,
): Promise<Developer[]> {
	const q = includeArchived ? "?includeArchived=1" : "";
	const raw = await apiFetch<{ items: unknown[] }>(`/api/developers${q}`);
	return raw.items.map(parseDeveloper);
}

export async function createDeveloper(
	name: string,
	alias: string,
): Promise<Developer> {
	const raw = await apiFetch<unknown>("/api/developers", {
		method: "POST",
		body: JSON.stringify({ name, alias }),
	});
	return parseDeveloper(raw);
}

export async function patchDeveloper(
	id: string,
	body: { name?: string; alias?: string },
): Promise<Developer> {
	const raw = await apiFetch<unknown>(`/api/developers/${id}`, {
		method: "PATCH",
		body: JSON.stringify(body),
	});
	return parseDeveloper(raw);
}

export async function archiveDeveloper(id: string): Promise<void> {
	await apiFetch(`/api/developers/${id}/archive`, { method: "POST" });
}

export async function listTeams(includeArchived = false): Promise<Team[]> {
	const q = includeArchived ? "?includeArchived=1" : "";
	const raw = await apiFetch<{ items: unknown[] }>(`/api/teams${q}`);
	return raw.items.map(parseTeam);
}

export async function createTeam(name: string): Promise<Team> {
	const raw = await apiFetch<unknown>("/api/teams", {
		method: "POST",
		body: JSON.stringify({ name }),
	});
	return parseTeam(raw);
}

export async function archiveTeam(id: string): Promise<void> {
	await apiFetch(`/api/teams/${id}/archive`, { method: "POST" });
}

export async function listTags(includeArchived = false): Promise<Tag[]> {
	const q = includeArchived ? "?includeArchived=1" : "";
	const raw = await apiFetch<{ items: unknown[] }>(`/api/tags${q}`);
	return raw.items.map(parseTag);
}

export async function createTag(name: string, color: string): Promise<Tag> {
	const raw = await apiFetch<unknown>("/api/tags", {
		method: "POST",
		body: JSON.stringify({ name, color }),
	});
	return parseTag(raw);
}

export async function archiveTag(id: string): Promise<void> {
	await apiFetch(`/api/tags/${id}/archive`, { method: "POST" });
}

export async function listRepos(includeArchived = false): Promise<Repo[]> {
	const q = includeArchived ? "?includeArchived=1" : "";
	const raw = await apiFetch<{ items: unknown[] }>(`/api/repos${q}`);
	return raw.items.map(parseRepo);
}

export async function createRepo(body: {
	provider?: string;
	org: string;
	project: string;
	name: string;
	externalId: string;
	projectExternalId?: string | null;
	enabled?: boolean;
}): Promise<Repo> {
	const raw = await apiFetch<unknown>("/api/repos", {
		method: "POST",
		body: JSON.stringify(body),
	});
	return parseRepo(raw);
}

export async function archiveRepo(id: string): Promise<void> {
	await apiFetch(`/api/repos/${id}/archive`, { method: "POST" });
}

export interface MeResponse {
	email: string | null;
	name: string | null;
	authenticated: boolean;
}

export async function fetchMe(): Promise<MeResponse> {
	return apiFetch<MeResponse>("/api/me");
}
