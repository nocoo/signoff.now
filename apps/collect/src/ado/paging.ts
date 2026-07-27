/**
 * Paginated fetches over the Azure DevOps endpoints collection needs (07 §7.3).
 *
 * Each endpoint pages differently, so there is no single generic paginator:
 * PR lists and work-item updates use `$skip`/`$top`, WIQL has no continuation
 * token and a hard result cap, and threads/iterations return complete sets.
 *
 * The recurring hazard is a page that silently drops a record. `$skip` is an
 * offset into a live, mutating result set, so a row changing mid-pagination can
 * shift others past the window with no duplicate to notice. Every helper here
 * therefore reports enough for the caller to mark a scope incomplete rather
 * than quietly return a short list.
 */

import { adoListSchema, type RawPr, rawPrSchema } from "@signoff/domain";
import { type AdoClient, AdoError, adoUrl } from "./client.ts";
import { oldestItemSchema, parseRaw, wiqlResultSchema } from "./parse-raw.ts";

export const PAGE_SIZE = 100;
/** Refuse to loop forever if the server keeps handing back full pages. */
export const MAX_PAGES = 200;

export type PageProblem = { reason: string };

export type PagedResult<T> = {
	items: T[];
	/** Non-empty when the caller must treat the scope as incomplete. */
	problems: PageProblem[];
};

/** ADO accepts only one `searchCriteria.status` per call (07 §7.3). */
export type PrStatus = "completed" | "abandoned" | "active";

export type PrQuery = {
	client: AdoClient;
	base: string;
	repoPath: string;
	status: PrStatus;
	/** Half-open `[from, watermark)`; omitted for `active`. */
	from?: string | null;
	watermark?: string;
	maxPages?: number;
};

/**
 * Fetch one PR status, paging by `$skip`.
 *
 * Results come back newest-closed first. That ordering is what lets us notice
 * a shifted window: if a page starts newer than the previous page ended, the
 * result set moved underneath us and the run can no longer claim completeness.
 */
export async function fetchPullRequests(
	q: PrQuery,
): Promise<PagedResult<RawPr>> {
	const items: RawPr[] = [];
	const problems: PageProblem[] = [];
	const seen = new Set<number>();
	const maxPages = q.maxPages ?? MAX_PAGES;
	let previousPageLast: string | null = null;

	for (let page = 0; page < maxPages; page++) {
		const url = adoUrl(q.base, `${q.repoPath}/pullrequests`, {
			"searchCriteria.status": q.status,
			"searchCriteria.minTime": q.from ?? undefined,
			// Bound BOTH ends. Without maxTime the rows newer than the watermark
			// still occupy $skip offsets and the page budget, so a busy repo can
			// be declared incomplete forever and stall its cursor.
			"searchCriteria.maxTime": q.status === "active" ? undefined : q.watermark,
			"searchCriteria.queryTimeRangeType":
				q.status === "active" ? undefined : "closed",
			$top: PAGE_SIZE,
			$skip: page * PAGE_SIZE,
		});
		const parsed = parseRaw(
			adoListSchema(rawPrSchema),
			await q.client.get(url),
			`pull requests (${q.status})`,
		);
		const batch = parsed.value;

		const first = batch[0]?.closedDate ?? null;
		if (previousPageLast && first && first > previousPageLast) {
			// Something was inserted or reordered ahead of an offset we already
			// passed, so a record may now sit behind us, unseen. The opposite
			// direction is just normal descending order and must NOT be flagged.
			problems.push({
				reason: `page ${page} starts newer than page ${page - 1} ended; the result set shifted mid-pagination`,
			});
		}

		for (const pr of batch) {
			if (seen.has(pr.pullRequestId)) {
				// A repeat means the server re-ordered under us; a record may have
				// slipped past the window with no duplicate to reveal it.
				problems.push({
					reason: `duplicate pull request ${pr.pullRequestId} across pages`,
				});
				continue;
			}
			seen.add(pr.pullRequestId);
			// The server-side filter is honoured (probed on live 7.1), but the
			// local check is what makes correctness independent of it.
			if (q.watermark && pr.closedDate && pr.closedDate >= q.watermark) {
				continue;
			}
			items.push(pr);
		}

		previousPageLast = batch[batch.length - 1]?.closedDate ?? previousPageLast;
		if (batch.length < PAGE_SIZE) {
			return { items, problems };
		}
	}

	problems.push({
		reason: `stopped after ${maxPages} pages; the window is too large to page safely`,
	});
	return { items, problems };
}

export type WiqlQuery = {
	client: AdoClient;
	base: string;
	project: string;
	from: string | null;
	watermark: string;
	/** Guard against unbounded recursion when a single instant is too large. */
	maxDepth?: number;
	/** Backwards steps allowed when the window has no lower bound. */
	maxOpenSteps?: number;
};

/**
 * WIQL compares `System.ChangedDate` at DATE precision and rejects any query
 * that supplies a time: "You cannot supply a time with the date when running a
 * query using date precision" — measured against live ADO, not assumed.
 *
 * Widening is the only safe rounding. `from` truncates to its own day and `to`
 * is pushed to the following day, so the queried range always CONTAINS the
 * requested one. A narrower range would skip work items permanently: the cursor
 * still advances past them, and the next incremental window starts later.
 */
export function wiqlDay(instant: string, addDays = 0): string {
	const ms = Date.parse(instant);
	if (!Number.isFinite(ms)) {
		// Callers pass watermarks the caller itself produced; a malformed one is
		// a bug, and silently querying "all time" would hide it.
		throw new AdoError("bad_request", `unparseable WIQL bound: ${instant}`);
	}
	return new Date(ms + addDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The project's earliest `System.ChangedDate`.
 *
 * Two extra calls (a WIQL POST for the id, then a work-item GET for its
 * `ChangedDate`) buy a real floor for open-ended sweeps, so the sweep no
 * longer has to guess where history ends.
 *
 * Failures are NOT caught here. Downgrading them to a `problems` entry would
 * flatten every cause into an `incomplete` scope, i.e. CONTRACT — telling
 * automation "your request is wrong" when a 403 means "grant access" and a 503
 * means "retry later". Letting the `AdoError` through keeps its kind all the
 * way to `exitCodeForError`.
 */
async function oldestChangedDate(
	q: WiqlQuery,
): Promise<{ floor: string } | { error: string }> {
	const res = parseRaw(
		wiqlResultSchema,
		await q.client.post(adoUrl(q.base, "_apis/wit/wiql", { $top: 1 }), {
			query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${q.project.replace(/'/g, "''")}' ORDER BY [System.ChangedDate] ASC`,
		}),
		"oldest work item query",
	);
	const id = res.workItems[0]?.id;
	if (id === undefined) {
		// This probe runs ONLY because the open query just failed with "more
		// than 20k work items". A `$top=1 ASC` answering "none" contradicts
		// that, so it cannot mean the project is empty. Reporting it as empty
		// would advance the cursor over a project that was never collected —
		// the silent truncation this whole path exists to prevent.
		return {
			error:
				"the cap said >20k work items but the oldest-item probe returned none; the results are inconsistent",
		};
	}
	const item = parseRaw(
		oldestItemSchema,
		await q.client.get(
			adoUrl(q.base, `_apis/wit/workitems/${id}`, {
				fields: "System.ChangedDate",
			}),
		),
		`work item ${id} changed date`,
	);
	const changed = item.fields["System.ChangedDate"];
	return typeof changed === "string" && Number.isFinite(Date.parse(changed))
		? { floor: changed }
		: { error: `work item ${id} has no readable System.ChangedDate` };
}

/**
 * Work item ids in `[from, watermark)`.
 *
 * WIQL has no continuation token: past ~20k rows it fails outright with
 * `VS402337`. The only recovery is to ask for less, so an over-large window is
 * bisected until each half fits. That is why the client classifies the error
 * body — an opaque 400 here would be unrecoverable.
 */
export async function fetchWorkItemIds(
	q: WiqlQuery,
): Promise<PagedResult<number>> {
	const problems: PageProblem[] = [];
	const ids = new Set<number>();

	const run = async (
		from: string | null,
		to: string,
		depth: number,
	): Promise<void> => {
		const clauses = [
			`[System.TeamProject] = '${q.project.replace(/'/g, "''")}'`,
		];
		if (from) {
			// Back off ONE day. WIQL evaluates date precision in the
			// ORGANIZATION's timezone, which we do not know: for a US-West org,
			// `2026-07-01T04:00:00Z` is locally 2026-06-30, so flooring to
			// `>= '2026-07-01'` would exclude it. The cursor advances either way,
			// so that work item would be skipped for good. One extra day of
			// overlap costs nothing — ids dedupe.
			clauses.push(`[System.ChangedDate] >= '${wiqlDay(from, -1)}'`);
		}
		// `<=` with the day AFTER `to`, not `<` with `to`'s own day: date
		// precision drops the time, so `< to` would exclude everything that
		// happened on `to` itself.
		clauses.push(`[System.ChangedDate] <= '${wiqlDay(to, 1)}'`);
		const query = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;

		try {
			const res = parseRaw(
				wiqlResultSchema,
				await q.client.post(adoUrl(q.base, "_apis/wit/wiql"), { query }),
				"WIQL result",
			);
			for (const w of res.workItems) {
				ids.add(w.id);
			}
		} catch (e) {
			if (!(e instanceof AdoError) || e.kind !== "result_too_large") {
				throw e;
			}
			if (depth >= (q.maxDepth ?? 12)) {
				problems.push({
					reason: `work item window ${from ?? "(open)"}..${to} exceeds the WIQL result cap and cannot be split further`,
				});
				return;
			}

			if (from === null) {
				// An open window still has a lower edge — we just have not found
				// it yet. Walk backwards in widening steps until a slice fits,
				// then keep walking past it. `--full` ALWAYS opens the window, so
				// refusing here means a large project can never complete a full
				// rematch, `scores_stale` never clears, and the Dashboard stays
				// blank forever with no way out.
				await runOpenEnded(to, depth);
				return;
			}
			const fromMs = Date.parse(from);
			const toMs = Date.parse(to);
			const midMs = Math.floor((fromMs + toMs) / 2);
			// Terminate in DAY space, because that is the space the query is
			// issued in. A millisecond-only guard keeps splitting long after both
			// halves round to the parent's own day range: measured 8191 calls for
			// a 2-day window, 5 distinct queries, one repeated 4083 times, and
			// 4096 near-identical `problems` entries serialized into the manifest.
			const mid = Number.isFinite(midMs) ? new Date(midMs).toISOString() : null;
			const narrows =
				mid !== null &&
				midMs > fromMs &&
				midMs < toMs &&
				wiqlDay(mid) > wiqlDay(from) &&
				wiqlDay(mid, 1) < wiqlDay(to, 1);
			if (!narrows) {
				problems.push({
					reason: `work item window ${from}..${to} is already one day wide and still exceeds the WIQL result cap`,
				});
				return;
			}
			await run(from, mid, depth + 1);
			await run(mid, to, depth + 1);
		}
	};

	/**
	 * Cover an open-ended window by walking backwards from `to`.
	 *
	 * The floor is ASKED FOR, not guessed: WIQL can order by `ChangedDate ASC`,
	 * so the project's oldest work item is two calls away. An earlier version
	 * stopped after three consecutive empty slices — 210 days — which declared a
	 * team that moved off a project eight months ago to have no history at all,
	 * reported no problem, let the cursor advance, and let `--full` clear
	 * `scores_stale`. A confidently empty Dashboard is worse than a blank one.
	 *
	 * Doubling the span keeps the call count logarithmic in how far back the
	 * history actually goes.
	 */
	const runOpenEnded = async (to: string, depth: number): Promise<void> => {
		const probe = await oldestChangedDate(q);
		if ("error" in probe) {
			// No floor and no answer: say so rather than assume emptiness.
			problems.push({
				reason: `could not determine the project's earliest work item (${probe.error}), so an open-ended window cannot be proven covered`,
			});
			return;
		}
		const floor = probe.floor;

		let end = to;
		let spanDays = 30;
		for (let step = 0; step < (q.maxOpenSteps ?? 60); step++) {
			if (Date.parse(end) <= Date.parse(floor)) {
				return;
			}
			const startMs = Math.max(
				Date.parse(end) - spanDays * 86_400_000,
				Date.parse(floor),
			);
			const start = new Date(startMs).toISOString();
			await run(start, end, depth + 1);
			end = start;
			spanDays = Math.min(spanDays * 2, 720);
		}
		problems.push({
			reason: `work item history before ${end} was not reached within the open-window step budget`,
		});
	};

	await run(q.from, q.watermark, 0);
	return { items: [...ids].sort((a, b) => a - b), problems };
}

/**
 * Fetch every update for a work item, deduplicating on the update's own `id`.
 *
 * `rev` is NOT unique — live data returns several records per revision — so
 * keying on it here would drop real records before the transform ever sees
 * them (07 §6.2.3).
 */
export async function fetchAllPages<T>(
	client: AdoClient,
	url: (skip: number) => string,
	parse: (raw: unknown) => T[],
	keyOf: (item: T) => string | number,
	maxPages = MAX_PAGES,
): Promise<PagedResult<T>> {
	const items: T[] = [];
	const problems: PageProblem[] = [];
	const seen = new Set<string | number>();

	for (let page = 0; page < maxPages; page++) {
		const batch = parse(await client.get(url(page * PAGE_SIZE)));
		for (const item of batch) {
			const key = keyOf(item);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			items.push(item);
		}
		if (batch.length < PAGE_SIZE) {
			return { items, problems };
		}
	}

	problems.push({ reason: `stopped after ${maxPages} pages` });
	return { items, problems };
}
