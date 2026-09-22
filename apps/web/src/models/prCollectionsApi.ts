import { type DataSource, publicSource } from "@signoff/domain/monitoring";
import {
	collectionMembershipsSchema,
	type PrCollection,
	type PrCollectionWrite,
	prCollectionSchema,
	prCollectionsSchema,
} from "@signoff/domain/pr-collections";
import { apiFetch } from "@/lib/api";

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
	const params = new URLSearchParams();
	for (const id of ids) params.append("pullId", id);
	return collectionMembershipsSchema.parse(
		await apiFetch(`${collectionPath(source, "/memberships")}&${params}`, {
			signal,
		}),
	);
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
	return prCollectionSchema.parse(
		await apiFetch(collectionPath(source, `/${c.id}/members`), {
			method: "PUT",
			body: JSON.stringify({ revision: c.revision, pullIds, action }),
		}),
	);
}
