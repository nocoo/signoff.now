import { beforeEach, expect, test, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	changeMembers,
	collectionHref,
	deleteCollection,
	loadCollections,
	loadMemberships,
	saveCollection,
} from "./prCollectionsApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
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
