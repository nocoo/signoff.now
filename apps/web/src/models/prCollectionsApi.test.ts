import { beforeEach, expect, test, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api";
import {
	changeMembers,
	collectionHref,
	deleteCollection,
	loadCollectionPulls,
	loadCollections,
	loadMemberships,
	saveCollection,
} from "./prCollectionsApi";

vi.mock("@/lib/api", async (original) => ({
	...(await original<typeof import("@/lib/api")>()),
	apiFetch: vi.fn(),
}));

import { queryFixture } from "@/test/monitoring-fixture";

const draft = {
	name: "Tests",
	description: "Coverage work",
	color: "violet" as const,
	icon: "flask" as const,
};
const collection = {
	...draft,
	id: "c1",
	source: "live" as const,
	revision: 3,
	createdAt: 1,
	updatedAt: 2,
	counts: { total: 2, open: 1, draft: 0, merged: 1, closed: 0 },
};
beforeEach(() => {
	vi.mocked(apiFetch).mockReset();
});

test("reads source-scoped, typed collections and batches encoded memberships", async () => {
	const signal = new AbortController().signal;
	vi.mocked(apiFetch)
		.mockResolvedValueOnce({ items: [collection] })
		.mockResolvedValueOnce({
			items: [{ pullId: "repo/1&2", collectionId: "c1" }],
		});
	expect((await loadCollections("cli", signal)).items).toEqual([collection]);
	expect(apiFetch).toHaveBeenNthCalledWith(
		1,
		"/api/pr-collections?source=live",
		{ signal },
	);
	expect(
		(await loadMemberships("demo", ["repo/1&2"], signal)).items,
	).toHaveLength(1);
	expect(apiFetch).toHaveBeenNthCalledWith(
		2,
		"/api/pr-collections/memberships?source=sample&pullId=repo%2F1%262",
		{ signal },
	);
	expect(collectionHref({ ...collection, id: "a/b" })).toBe(
		"/collections/a%2Fb?source=live",
	);
	vi.mocked(apiFetch).mockResolvedValue({
		items: [{ ...collection, revision: 0 }],
	});
	await expect(loadCollections("cli", signal)).rejects.toThrow();
});
test("creates without a revision and edits with the exact revision", async () => {
	vi.mocked(apiFetch).mockResolvedValue(collection);
	await saveCollection("cli", draft);
	expect(apiFetch).toHaveBeenLastCalledWith("/api/pr-collections?source=live", {
		method: "POST",
		body: JSON.stringify(draft),
	});
	await saveCollection("cli", draft, collection);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/pr-collections/c1?source=live",
		{ method: "PATCH", body: JSON.stringify({ ...draft, revision: 3 }) },
	);
});
test("member changes and deletion use CAS without replacing unrelated membership", async () => {
	vi.mocked(apiFetch).mockResolvedValue(collection);
	for (const action of ["add", "remove"] as const) {
		await changeMembers("cli", collection, ["p1"], action);
		expect(apiFetch).toHaveBeenLastCalledWith(
			"/api/pr-collections/c1/members?source=live",
			{
				method: "PUT",
				body: JSON.stringify({ revision: 3, pullIds: ["p1"], action }),
			},
		);
	}
	vi.mocked(apiFetch).mockResolvedValue({ deleted: true });
	expect(await deleteCollection("cli", collection)).toEqual({ deleted: true });
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/pr-collections/c1?source=live&revision=3",
		{ method: "DELETE" },
	);
	vi.mocked(apiFetch).mockRejectedValue(new Error("Collection changed"));
	await expect(changeMembers("cli", collection, ["p1"], "add")).rejects.toThrow(
		"Collection changed",
	);
});

test("loads every cursor in a coherent collection snapshot and bounds snapshot retries", async () => {
	const signal = new AbortController().signal;
	const first = queryFixture().pulls;
	const page = {
		...first,
		page: { limit: 200, total: 2, nextCursor: "next/1" },
	};
	vi.mocked(apiFetch).mockImplementation(async (url) =>
		structuredClone(url.includes("cursor=") ? first : page),
	);
	expect(
		(await loadCollectionPulls("collectionId=c1&page=1&limit=20", signal)).data,
	).toHaveLength(2);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/query/v1/prs?collectionId=c1&limit=200&cursor=next%2F1",
		{ signal },
	);
	const changed = new ApiError("Changed", 409, {
		error: { code: "SNAPSHOT_CHANGED" },
	});
	vi.mocked(apiFetch)
		.mockReset()
		.mockRejectedValueOnce(changed)
		.mockResolvedValue(structuredClone(first));
	expect(
		(await loadCollectionPulls("collectionId=c1", signal)).data,
	).toHaveLength(1);
	expect(apiFetch).toHaveBeenCalledTimes(2);
	vi.mocked(apiFetch).mockReset().mockRejectedValue(changed);
	await expect(loadCollectionPulls("collectionId=c1", signal)).rejects.toThrow(
		"Changed",
	);
	expect(apiFetch).toHaveBeenCalledTimes(3);
	vi.mocked(apiFetch)
		.mockReset()
		.mockImplementation(async () => structuredClone(page));
	await expect(loadCollectionPulls("collectionId=c1", signal)).rejects.toThrow(
		"repeated cursor",
	);
	for (const error of [
		new Error("offline"),
		new ApiError("Denied", 403),
		new ApiError("bad", 400, {}),
	]) {
		vi.mocked(apiFetch).mockReset().mockRejectedValue(error);
		await expect(
			loadCollectionPulls("collectionId=c1", signal),
		).rejects.toThrow();
		expect(apiFetch).toHaveBeenCalledTimes(1);
	}
});
test("large memberships respect batch limits and advance CAS revisions", async () => {
	const ids = Array.from({ length: 205 }, (_, i) => `p${i}`);
	vi.mocked(apiFetch)
		.mockResolvedValueOnce({ items: [{ pullId: "p0", collectionId: "c1" }] })
		.mockResolvedValueOnce({ items: [{ pullId: "p204", collectionId: "c1" }] });
	expect(
		(await loadMemberships("cli", ids, new AbortController().signal)).items,
	).toHaveLength(2);
	expect(
		new URL(
			vi.mocked(apiFetch).mock.calls[0]![0],
			"http://local",
		).searchParams.getAll("pullId"),
	).toHaveLength(200);
	expect(
		new URL(
			vi.mocked(apiFetch).mock.calls[1]![0],
			"http://local",
		).searchParams.getAll("pullId"),
	).toHaveLength(5);
	vi.mocked(apiFetch)
		.mockReset()
		.mockResolvedValueOnce({ ...collection, revision: 4 })
		.mockResolvedValueOnce({ ...collection, revision: 5 });
	expect((await changeMembers("cli", collection, ids, "remove")).revision).toBe(
		5,
	);
	expect(
		JSON.parse(vi.mocked(apiFetch).mock.calls[1]![1]!.body as string),
	).toEqual({ revision: 4, pullIds: ids.slice(200), action: "remove" });
});
