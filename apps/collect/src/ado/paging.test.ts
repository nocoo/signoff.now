import { describe, expect, test } from "bun:test";
import type { AdoClient } from "./client.ts";
import { AdoError } from "./client.ts";
import {
	fetchAllPages,
	fetchPullRequests,
	fetchWorkItemIds,
	PAGE_SIZE,
	wiqlDay,
} from "./paging.ts";

const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";

function pr(id: number, closedDate?: string) {
	return {
		pullRequestId: id,
		status: "completed",
		creationDate: "2026-07-01T00:00:00Z",
		closedDate,
		createdBy: { uniqueName: "ada@example.com" },
		repository: { id: REPO_GUID, project: { id: PROJ_GUID } },
	};
}

/** A client that replays scripted responses and records the URLs asked for. */
function scripted(responses: unknown[]) {
	const urls: string[] = [];
	const bodies: unknown[] = [];
	const client: AdoClient = {
		async get(url) {
			urls.push(url);
			return responses.shift() ?? { value: [] };
		},
		async post(url, body) {
			urls.push(url);
			bodies.push(body);
			const next = responses.shift();
			if (next instanceof Error) {
				throw next;
			}
			return next ?? { workItems: [] };
		},
		invalidateToken() {},
	};
	return { client, urls, bodies };
}

const base = "https://dev.azure.com/acme/Alpha/";
const repoPath = "_apis/git/repositories/alpha-repo";

describe("fetchPullRequests", () => {
	test("returns a single short page without asking for another", async () => {
		const { client, urls } = scripted([
			{ value: [pr(1, "2026-07-05T00:00:00Z")] },
		]);
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
		});
		expect(r.items).toHaveLength(1);
		expect(r.problems).toEqual([]);
		expect(urls).toHaveLength(1);
	});

	test("pages until a short page arrives", async () => {
		const full = {
			value: Array.from({ length: PAGE_SIZE }, (_, i) =>
				pr(
					1000 - i,
					`2026-07-${String(28 - (i % 27)).padStart(2, "0")}T00:00:00Z`,
				),
			),
		};
		const { client, urls } = scripted([
			full,
			{ value: [pr(1, "2026-06-01T00:00:00Z")] },
		]);
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
		});
		expect(r.items).toHaveLength(PAGE_SIZE + 1);
		expect(urls[1]).toContain(`%24skip=${PAGE_SIZE}`);
	});

	test("carries the time window and status into the query", async () => {
		const { client, urls } = scripted([{ value: [] }]);
		await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "abandoned",
			from: "2026-07-01T00:00:00Z",
		});
		expect(urls[0]).toContain("searchCriteria.status=abandoned");
		expect(urls[0]).toContain("searchCriteria.minTime=2026-07-01");
		expect(urls[0]).toContain("queryTimeRangeType=closed");
	});

	test("bounds both ends of the window", async () => {
		const { client, urls } = scripted([{ value: [] }]);
		await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
			from: "2026-07-01T00:00:00Z",
			watermark: "2026-07-26T00:00:00Z",
		});
		// Without maxTime the newer rows still consume $skip offsets and the page
		// budget, so a busy repo can be declared incomplete forever.
		expect(urls[0]).toContain("searchCriteria.minTime=2026-07-01");
		expect(urls[0]).toContain("searchCriteria.maxTime=2026-07-26");
	});

	test("descending pages with distinct timestamps report nothing", async () => {
		// Real pagination walks strictly backwards in time; flagging that would
		// mark every busy repo incomplete and stall its cursor forever.
		const pageA = {
			value: Array.from({ length: PAGE_SIZE }, (_, i) =>
				pr(2000 - i, "2026-07-20T00:00:00Z"),
			),
		};
		const pageB = { value: [pr(1, "2026-07-01T00:00:00Z")] };
		const { client } = scripted([pageA, pageB]);
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
		});
		expect(r.problems).toEqual([]);
	});

	test("active PRs are not time-filtered", async () => {
		// They have no closedDate to filter on, and the set is small.
		const { client, urls } = scripted([{ value: [] }]);
		await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "active",
			from: "2026-07-01T00:00:00Z",
		});
		expect(urls[0]).not.toContain("queryTimeRangeType");
	});

	test("excludes anything at or past the watermark", async () => {
		// The server filter is honoured, but correctness must not depend on it.
		const { client } = scripted([
			{
				value: [pr(1, "2026-07-26T13:00:00Z"), pr(2, "2026-07-26T11:00:00Z")],
			},
		]);
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
			watermark: "2026-07-26T12:00:00Z",
		});
		expect(r.items.map((p) => p.pullRequestId)).toEqual([2]);
	});

	test("a duplicate across pages is reported, not silently merged", async () => {
		const full = {
			value: Array.from({ length: PAGE_SIZE }, (_, i) =>
				pr(1000 - i, "2026-07-20T00:00:00Z"),
			),
		};
		const { client } = scripted([
			full,
			{ value: [pr(1000, "2026-07-20T00:00:00Z")] },
		]);
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
		});
		// A repeat means the result set re-ordered; something may have slipped
		// past the window with no duplicate to reveal it.
		expect(r.problems.some((p) => p.reason.includes("duplicate"))).toBe(true);
	});

	test("a page that starts newer than the last ended is reported", async () => {
		const pageA = {
			value: Array.from({ length: PAGE_SIZE }, (_, i) =>
				pr(2000 - i, "2026-07-10T00:00:00Z"),
			),
		};
		const pageB = { value: [pr(1, "2026-07-25T00:00:00Z")] };
		const { client } = scripted([pageA, pageB]);
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
		});
		expect(r.problems.some((p) => p.reason.includes("shifted"))).toBe(true);
	});

	test("an endless stream of full pages stops and reports", async () => {
		const full = {
			value: Array.from({ length: PAGE_SIZE }, (_, i) => pr(9000 - i)),
		};
		const { client } = scripted(Array.from({ length: 10 }, () => full));
		const r = await fetchPullRequests({
			client,
			base,
			repoPath,
			status: "completed",
			maxPages: 3,
		});
		expect(r.problems.some((p) => p.reason.includes("stopped after"))).toBe(
			true,
		);
	});
});

describe("fetchWorkItemIds", () => {
	test("returns sorted, deduplicated ids", async () => {
		const { client } = scripted([
			{ workItems: [{ id: 5 }, { id: 2 }, { id: 5 }] },
		]);
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: "2026-07-01T00:00:00Z",
			watermark: "2026-07-26T00:00:00Z",
		});
		expect(r.items).toEqual([2, 5]);
		expect(r.problems).toEqual([]);
	});

	test("the query is bounded on both sides", async () => {
		const { client, bodies } = scripted([{ workItems: [] }]);
		await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: "2026-07-01T00:00:00Z",
			watermark: "2026-07-26T00:00:00Z",
		});
		const q = (bodies[0] as { query: string }).query;
		// An open upper bound would sweep in rows written during pagination.
		// WIQL compares at DATE precision and REJECTS a supplied time, so the
		// bounds are days — widened, never narrowed, or work items whose day
		// falls on the edge would be skipped for good.
		// BOTH ends round outward. The lower bound backs off a day because WIQL
		// evaluates dates in the ORGANIZATION's timezone, which we cannot see:
		// 04:00Z is the previous day in a US-West org, and the cursor advances
		// regardless, so a floored bound would skip that item permanently.
		expect(q).toContain(">= '2026-06-30'");
		expect(q).toContain("<= '2026-07-27'");
		expect(q).not.toMatch(/T\d\d:/);
	});

	test("a project name with a quote cannot break the query", async () => {
		const { client, bodies } = scripted([{ workItems: [] }]);
		await fetchWorkItemIds({
			client,
			base,
			project: "O'Brien",
			from: null,
			watermark: "2026-07-26T00:00:00Z",
		});
		expect((bodies[0] as { query: string }).query).toContain("'O''Brien'");
	});

	test("an oversized window is bisected until each half fits", async () => {
		const tooLarge = new AdoError(
			"result_too_large",
			"VS402337: exceeds the size limit of 20000",
			400,
			"VS402337",
		);
		const { client, bodies } = scripted([
			tooLarge,
			{ workItems: [{ id: 1 }] },
			{ workItems: [{ id: 2 }] },
		]);
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: "2026-07-01T00:00:00Z",
			watermark: "2026-07-03T00:00:00Z",
		});
		expect(r.items).toEqual([1, 2]);
		expect(r.problems).toEqual([]);
		// Three calls: the failed whole, then each half.
		expect(bodies).toHaveLength(3);
		// The halves must together COVER the original window. Date rounding
		// widens each side, so they overlap — harmless, since ids dedupe — but a
		// gap between them would drop work items with nothing to reveal it.
		const halves = bodies.slice(1).map((b) => (b as { query: string }).query);
		expect(halves[0]).toContain(">= '2026-06-30'");
		expect(halves[1]).toContain("<= '2026-07-04'");
		for (const q of halves) {
			expect(q).not.toMatch(/T\d\d:/);
		}
	});

	test("bisection stops when the DAY range stops narrowing", async () => {
		// The termination guard compares milliseconds, but the query is issued in
		// days. Once a span drops under ~1 day both halves round to the parent's
		// own day range, so recursion continues while every child fires the
		// identical query: measured 8191 calls, 5 distinct queries, one of them
		// repeated 4083 times, and 4096 duplicate `problems` entries.
		const tooLarge = new AdoError("result_too_large", "cap", 400, "VS402337");
		const seen = new Map<string, number>();
		let calls = 0;
		const client: AdoClient = {
			async get() {
				return { value: [] };
			},
			async post(_u, body) {
				calls++;
				const q = (body as { query: string }).query;
				seen.set(q, (seen.get(q) ?? 0) + 1);
				throw tooLarge;
			},
			invalidateToken() {},
		};
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: "2026-07-01T00:00:00Z",
			watermark: "2026-07-03T00:00:00Z",
		});
		// A 2-day window has at most 2 single-day leaves; anything beyond that is
		// re-asking a question already answered.
		expect(calls).toBeLessThanOrEqual(8);
		expect(Math.max(...seen.values())).toBe(1);
		// And the operator gets one actionable problem, not thousands.
		expect(r.problems.length).toBeLessThanOrEqual(3);
	});

	/**
	 * A client that answers the floor probe (oldest work item) and then serves
	 * scripted slices. The floor is what makes an open-ended sweep provable.
	 */
	function openEndedClient(opts: {
		oldest: string | null;
		slice?: (lo: string) => unknown;
	}): { client: AdoClient; queries: string[] } {
		const queries: string[] = [];
		const client: AdoClient = {
			async get(url) {
				if (url.includes("/workitems/")) {
					// `oldest: null` models a field we cannot read, which is NOT
					// the same as a project with no work items.
					return {
						fields: opts.oldest ? { "System.ChangedDate": opts.oldest } : {},
					};
				}
				return { value: [] };
			},
			async post(_u, body) {
				const q = (body as { query: string }).query;
				if (q.includes("ORDER BY [System.ChangedDate] ASC")) {
					return { workItems: [{ id: 1 }] };
				}
				queries.push(q);
				const lo = /\bChangedDate\] >= '(\d{4}-\d{2}-\d{2})'/.exec(q)?.[1];
				// An open window (no lower bound) is what trips the cap and sends
				// the caller into the backwards sweep.
				if (lo === undefined) {
					throw new AdoError("result_too_large", "cap", 400, "VS402337");
				}
				return opts.slice?.(lo) ?? { workItems: [] };
			},
			invalidateToken() {},
		};
		return { client, queries };
	}

	test("an unbounded window sweeps back to the project's real floor", async () => {
		// `--full` ALWAYS opens the window. Refusing here meant a large project
		// could never complete a full rematch, so `scores_stale` never cleared
		// and the Dashboard stayed blank with no way out.
		const { client, queries } = openEndedClient({
			oldest: "2026-01-01T00:00:00Z",
			slice: (lo) =>
				lo === "2026-06-25" ? { workItems: [{ id: 7 }] } : { workItems: [] },
		});
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: null,
			watermark: "2026-07-26T00:00:00Z",
		});
		expect(r.items).toEqual([7]);
		expect(r.problems).toEqual([]);

		// The first entry is the open query that tripped the cap; the sweep
		// starts after it.
		const days = queries
			.map((q) => /\bChangedDate\] >= '(\d{4}-\d{2}-\d{2})'/.exec(q)?.[1])
			.filter((d): d is string => d !== undefined);
		// Spans must DOUBLE, not merely recede. A fixed 30-day step also walks
		// backwards, but takes ~120 calls per decade instead of ~8 — each one a
		// round trip against a rate-limited API.
		expect(days[0]).toBe("2026-06-25");
		expect(days[1]).toBe("2026-04-26");
		// Clamped at the floor (2026-01-01) rather than sweeping into empty
		// prehistory — the third span would otherwise reach 2025-12-27.
		expect(days[2]).toBe("2025-12-31");
		expect(days).toHaveLength(3);
	});

	test("the span stops doubling at the 720-day cap", async () => {
		// Without a ceiling the span reaches decades and a single slice blows the
		// result cap again, restarting the bisection it was meant to avoid.
		const { client, queries } = openEndedClient({
			oldest: "2010-01-01T00:00:00Z",
			slice: () => ({ workItems: [] }),
		});
		await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: null,
			watermark: "2026-07-26T00:00:00Z",
			maxOpenSteps: 12,
		});
		const days = queries
			.map((q) => /\bChangedDate\] >= '(\d{4}-\d{2}-\d{2})'/.exec(q)?.[1])
			.filter((d): d is string => d !== undefined);
		const gaps = days
			.slice(1)
			.map(
				(d, i) =>
					(Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) /
					86_400_000,
			);
		expect(Math.max(...gaps)).toBe(720);
	});

	test("a dormant project is swept to its floor, not declared empty", async () => {
		// Everything predates the near slices. Guessing "3 empty slices = done"
		// covered only 210 days, so a team that moved off a project months ago
		// looked like it never existed — with no problem reported, the cursor
		// advancing, and `--full` clearing stale over it.
		const { client } = openEndedClient({
			oldest: "2025-01-01T00:00:00Z",
			slice: (lo) =>
				lo < "2025-11-01" ? { workItems: [{ id: 3 }] } : { workItems: [] },
		});
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: null,
			watermark: "2026-07-26T00:00:00Z",
		});
		expect(r.items).toEqual([3]);
		expect(r.problems).toEqual([]);
	});

	test("an unreadable floor is reported rather than assumed empty", async () => {
		// "We could not check" must never be recorded as "there is nothing
		// there": the scope has to block the cursor.
		const { client } = openEndedClient({ oldest: null });
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: null,
			watermark: "2026-07-26T00:00:00Z",
		});
		expect(r.problems).toHaveLength(1);
		expect(r.problems[0]?.reason).toContain("earliest work item");
	});

	test("the backwards walk has a step budget and reports when it runs out", async () => {
		// A decade of history against a tiny budget. Never silently truncate:
		// an unfinished sweep must block the cursor.
		const { client } = openEndedClient({
			oldest: "2015-06-04T00:00:00Z",
			slice: () => ({ workItems: [{ id: 1 }] }),
		});
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: null,
			watermark: "2026-07-26T00:00:00Z",
			maxOpenSteps: 3,
		});
		expect(r.problems).toHaveLength(1);
		expect(r.problems[0]?.reason).toContain("step budget");
	});

	test("bisection stops at the depth limit rather than recursing forever", async () => {
		const tooLarge = new AdoError("result_too_large", "cap", 400, "VS402337");
		const { client } = scripted(Array.from({ length: 40 }, () => tooLarge));
		const r = await fetchWorkItemIds({
			client,
			base,
			project: "Alpha",
			from: "2026-07-01T00:00:00Z",
			watermark: "2026-07-26T00:00:00Z",
			maxDepth: 2,
		});
		expect(r.problems.length).toBeGreaterThan(0);
	});

	test("errors other than the result cap propagate", async () => {
		const { client } = scripted([new AdoError("forbidden", "no access", 403)]);
		await expect(
			fetchWorkItemIds({
				client,
				base,
				project: "Alpha",
				from: null,
				watermark: "2026-07-26T00:00:00Z",
			}),
		).rejects.toMatchObject({ kind: "forbidden" });
	});
});

describe("fetchAllPages", () => {
	const parse = (raw: unknown) => (raw as { value: { id: number }[] }).value;

	test("dedupes on the caller's key", async () => {
		// `rev` is not unique for work item updates, so the key must be `id`.
		const { client } = scripted([
			{
				value: [
					{ id: 1, rev: 5 },
					{ id: 2, rev: 5 },
					{ id: 1, rev: 5 },
				],
			},
		]);
		const r = await fetchAllPages(
			client,
			(skip) => `https://x/y?$skip=${skip}`,
			parse,
			(i) => i.id,
		);
		expect(r.items.map((i) => i.id)).toEqual([1, 2]);
	});

	test("stops at the page cap and says so", async () => {
		const full = {
			value: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })),
		};
		const { client } = scripted([full, full, full]);
		const r = await fetchAllPages(
			client,
			(skip) => `https://x/y?$skip=${skip}`,
			parse,
			(i) => i.id,
			2,
		);
		expect(r.problems[0]?.reason).toContain("stopped after 2 pages");
	});
});

describe("wiqlDay", () => {
	test("drops the time, which WIQL rejects outright", async () => {
		// Measured against live ADO: "You cannot supply a time with the date when
		// running a query using date precision."
		expect(wiqlDay("2026-07-26T04:26:24.000Z")).toBe("2026-07-26");
	});

	test("rounds the upper bound OUTWARD, never inward", async () => {
		// A narrower window skips work items permanently: the cursor still
		// advances past them and the next incremental window starts later.
		expect(wiqlDay("2026-07-26T23:59:59Z", 1)).toBe("2026-07-27");
		expect(wiqlDay("2026-07-26T00:00:00Z", 1)).toBe("2026-07-27");
	});

	test("crosses month and year boundaries", async () => {
		expect(wiqlDay("2026-07-31T12:00:00Z", 1)).toBe("2026-08-01");
		expect(wiqlDay("2026-12-31T12:00:00Z", 1)).toBe("2027-01-01");
	});

	test("an unparseable bound is a bug, not a query for all time", async () => {
		// Silently widening to everything would hide the defect and hammer ADO.
		const err = (() => {
			try {
				wiqlDay("not-a-date");
			} catch (e) {
				return e;
			}
		})();
		expect(err).toBeInstanceOf(AdoError);
		// The KIND is what decides the exit code: `bad_request` → CONTRACT.
		// `toThrow(AdoError)` alone would accept any kind at all.
		expect((err as AdoError).kind).toBe("bad_request");
	});
});
