import type { DataSource, DirectoryData } from "@signoff/domain/insights";
import { apiFetch } from "@/lib/api";
import type { DirectoryDraftMap, DirectoryKind } from "./directory";

export async function fetchDirectory(
	source: DataSource,
): Promise<DirectoryData> {
	const data = await apiFetch<DirectoryData>(`/api/directory?source=${source}`);
	if (!data || data.source !== source)
		throw new Error("Directory source mismatch");
	return data;
}

export function saveDirectoryEntity<K extends DirectoryKind>(
	source: DataSource,
	kind: K,
	id: string | null,
	draft: DirectoryDraftMap[K],
	revision: number,
): Promise<{ id: string }> {
	return apiFetch(
		`/api/directory/${kind}${id === null ? "" : `/${encodeURIComponent(id)}`}?source=${source}`,
		{
			method: id === null ? "POST" : "PUT",
			headers: { "If-Match": `"${revision}"` },
			body: JSON.stringify(draft),
		},
	);
}

export async function setDirectoryArchived(
	source: DataSource,
	kind: DirectoryKind,
	id: string,
	archived: boolean,
	revision: number,
): Promise<void> {
	await apiFetch(
		`/api/directory/${kind}/${encodeURIComponent(id)}/${archived ? "archive" : "restore"}?source=${source}`,
		{ method: "POST", headers: { "If-Match": `"${revision}"` } },
	);
}
