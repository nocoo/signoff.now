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
import { parseRaw, wiqlResultSchema } from "./parse-raw.ts";

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
};

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
			clauses.push(`[System.ChangedDate] >= '${from}'`);
		}
		clauses.push(`[System.ChangedDate] < '${to}'`);
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
			if (depth >= (q.maxDepth ?? 12) || from === null) {
				// Without a lower bound there is nothing left to halve.
				problems.push({
					reason: `work item window ${from ?? "(open)"}..${to} exceeds the WIQL result cap and cannot be split further`,
				});
				return;
			}
			const fromMs = Date.parse(from);
			const toMs = Date.parse(to);
			const midMs = Math.floor((fromMs + toMs) / 2);
			if (!Number.isFinite(midMs) || midMs <= fromMs || midMs >= toMs) {
				problems.push({
					reason: `cannot split window ${from}..${to} any further`,
				});
				return;
			}
			const mid = new Date(midMs).toISOString();
			await run(from, mid, depth + 1);
			await run(mid, to, depth + 1);
		}
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
