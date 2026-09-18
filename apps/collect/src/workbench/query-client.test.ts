import { expect, test } from "bun:test";
import { parsePrArgument, queryRequest, readAllPages } from "./query-client";

test("PR references require complete scope and never infer a repository from a number", () => {
	expect(() => parsePrArgument("42")).toThrow(/repository/i);
	expect(parsePrArgument("42", "https://github.com/nocoo/signoff.now")).toEqual(
		{ url: "https://github.com/nocoo/signoff.now/pull/42" },
	);
	expect(parsePrArgument("ado:p:r:42")).toEqual({ pullId: "ado:p:r:42" });
	expect(() => parsePrArgument("https://example.org/42")).toThrow();
});
test("cached clients use loopback without credentials or redirects", async () => {
	let calls = 0;
	await queryRequest(
		{
			fetchImpl: async (_url, init) => {
				calls++;
				expect(init?.redirect).toBe("error");
				expect(new Headers(init?.headers).has("authorization")).toBe(false);
				return Response.json({ ok: true });
			},
		},
		"GET",
		"/api/query/v1/collector",
	);
	expect(calls).toBe(1);
	await expect(
		queryRequest(
			{ apiBase: "https://example.com" },
			"GET",
			"/api/query/v1/collector",
		),
	).rejects.toThrow(/local/i);
});
test("all pages restart on snapshot change, buffer output, and stop after two restarts", async () => {
	let calls = 0;
	const list = await readAllPages(async (cursor) => {
		calls++;
		if (calls === 2)
			throw { status: 409, body: { error: { code: "SNAPSHOT_CHANGED" } } };
		return {
			data: [cursor ? 2 : 1],
			page: { limit: 1, total: 2, nextCursor: cursor ? null : "next" },
			dataRevision: calls > 2 ? "2" : "1",
		};
	});
	expect(list.data).toEqual([1, 2]);
	expect(calls).toBe(4);
	calls = 0;
	await expect(
		readAllPages(async () => {
			calls++;
			throw { status: 409, body: { error: { code: "SNAPSHOT_CHANGED" } } };
		}),
	).rejects.toMatchObject({ status: 409 });
	expect(calls).toBe(3);
});
