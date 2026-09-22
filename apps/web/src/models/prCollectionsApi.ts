import { type DataSource, publicSource } from "@signoff/domain/monitoring";
import {
	collectionMembershipsSchema,
	type PrCollection,
	type PrCollectionWrite,
	prCollectionSchema,
	prCollectionsSchema,
} from "@signoff/domain/pr-collections";
import { ApiError, apiFetch } from "@/lib/api";

import { loadPulls } from "./monitoringApi";

export const collectionPath = (source: DataSource, path = "") =>
	`/api/pr-collections${path}?source=${publicSource(source)}`;
export const collectionHref = (c: Pick<PrCollection, "id" | "source">) =>
	`/collections/${encodeURIComponent(c.id)}?source=${c.source}`;
export async function loadCollections(source: DataSource, signal: AbortSignal) {
	return prCollectionsSchema.parse(
		await apiFetch(collectionPath(source), { signal }),
	);
}
export async function loadMemberships(
	source: DataSource,
	ids: string[],
	signal: AbortSignal,
) {
	const items: { pullId: string; collectionId: string }[] = [];
	for (let offset = 0; offset < ids.length; offset += 200) {
		const params = new URLSearchParams();
		for (const id of ids.slice(offset, offset + 200))
			params.append("pullId", id);
		const result = collectionMembershipsSchema.parse(
			await apiFetch(`${collectionPath(source, "/memberships")}&${params}`, {
				signal,
			}),
		);
		items.push(...result.items);
	}
	return { items };
}
export async function saveCollection(
	source: DataSource,
	draft: PrCollectionWrite,
	current?: PrCollection,
) {
	return prCollectionSchema.parse(
		await apiFetch(collectionPath(source, current ? `/${current.id}` : ""), {
			method: current ? "PATCH" : "POST",
			body: JSON.stringify({
				...draft,
				...(current ? { revision: current.revision } : {}),
			}),
		}),
	);
}
export async function deleteCollection(source: DataSource, c: PrCollection) {
	return apiFetch<{ deleted: boolean }>(
		`${collectionPath(source, `/${c.id}`)}&revision=${c.revision}`,
		{ method: "DELETE" },
	);
}
export async function changeMembers(
	source: DataSource,
	c: PrCollection,
	pullIds: string[],
	action: "add" | "remove",
) {
	let current = c;
	for (let offset = 0; offset < pullIds.length; offset += 200) {
		current = prCollectionSchema.parse(
			await apiFetch(collectionPath(source, `/${c.id}/members`), {
				method: "PUT",
				body: JSON.stringify({
					revision: current.revision,
					pullIds: pullIds.slice(offset, offset + 200),
					action,
				}),
			}),
		);
	}
	return current;
}

export async function loadCollectionPulls(query: string, signal: AbortSignal) {
	const params = new URLSearchParams(query);
	params.set("limit", "200");
	params.delete("page");
	for (let attempt = 0; ; attempt++) {
		try {
			const first = await loadPulls(params.toString(), signal);
			let cursor = first.page.nextCursor;
			const seen = new Set<string>();
			while (cursor) {
				if (seen.has(cursor))
					throw new Error("Collection query returned a repeated cursor");
				seen.add(cursor);
				const next = await loadPulls(
					`${params}&cursor=${encodeURIComponent(cursor)}`,
					signal,
				);
				first.data.push(...next.data);
				cursor = next.page.nextCursor;
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
