/**
 * ViewModel hook for the Pull Requests dashboard.
 *
 * Single source of truth: tRPC queries (DB-backed). Mutations only
 * write DB + invalidate queries, never return data to the View.
 *
 * Two layers:
 * - List layer: getCachedPrs (state filter in SQL) + client-side authorFilter
 * - Detail layer: getCachedPrDetail (JOIN pull_requests + pull_request_details)
 */

import type { PrDetail, PullRequestInfo } from "@signoff/pulse";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Client-side author filter. Case-insensitive partial match on author login.
 * Returns all PRs when authorFilter is empty.
 */
export function filterPrsByAuthor(
	prs: PullRequestInfo[],
	authorFilter: string,
): PullRequestInfo[] {
	if (!authorFilter) return prs;
	const needle = authorFilter.toLowerCase();
	return prs.filter((pr) => pr.author.toLowerCase().includes(needle));
}

/**
 * Derive the isLoading state from query + mutation status.
 *
 * True when:
 * - The query is still loading (initial fetch from DB), OR
 * - DB returned empty (no cached data) and a mutation is in flight
 *
 * Uses unfiltered cache length to prevent authorFilter from affecting
 * the loading state.
 */
export function deriveIsLoading(
	queryIsLoading: boolean,
	hasCachedData: boolean,
	mutationIsPending: boolean,
): boolean {
	return queryIsLoading || (!hasCachedData && mutationIsPending);
}

/**
 * Derive the isDetailLoading state.
 *
 * True when a PR is selected AND either:
 * - The detail query is still loading, OR
 * - Query returned null (no cache) and detail mutation is in flight
 */
export function deriveIsDetailLoading(
	selectedPrNumber: number | null,
	detailQueryIsLoading: boolean,
	detailData: unknown | null | undefined,
	detailMutationIsPending: boolean,
): boolean {
	return (
		selectedPrNumber !== null &&
		(detailQueryIsLoading || (!detailData && detailMutationIsPending))
	);
}

export interface UsePrViewModelReturn {
	// List
	prs: PullRequestInfo[];
	isLoading: boolean;
	isRefreshing: boolean;
	scanError: string | null;
	hasNextPage: boolean;
	stateFilter: "open" | "closed" | "all";
	setStateFilter: (filter: "open" | "closed" | "all") => void;
	authorFilter: string;
	setAuthorFilter: (filter: string) => void;
	scan: () => void;
	loadMore: () => void;

	// Detail
	selectedPrNumber: number | null;
	selectPr: (number: number | null) => void;
	selectedPrDetail: PrDetail | null;
	isDetailLoading: boolean;
	isDetailRefreshing: boolean;
	detailError: string | null;
}

export function usePrViewModel(projectId: string): UsePrViewModelReturn {
	const utils = trpc.useUtils();
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);
	const [authorFilter, setAuthorFilter] = useState("");
	const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

	// ── List Layer (queries are the single source of truth) ──

	// Cached list from DB (instant on mount), filtered by state in SQL
	const cachedPrsQuery = trpc.pulse.getCachedPrs.useQuery({
		projectId,
		state: stateFilter,
	});

	// Scan metadata — one record per project (no state dimension)
	const scanMetaQuery = trpc.pulse.getScanMeta.useQuery({ projectId });

	// List fetch mutation — always fetches state:"all" from GitHub,
	// writes DB, invalidates queries, returns nothing.
	// State filter is applied at query time, not fetch time.
	const scanMutation = trpc.pulse.fetchPrs.useMutation({
		onSuccess: () => {
			// Invalidate all getCachedPrs queries (all projects, all state variants).
			// Broad invalidation is cheap — just marks queries stale for next access.
			utils.pulse.getCachedPrs.invalidate();
			utils.pulse.getScanMeta.invalidate({ projectId });
		},
	});

	// Auto-refresh on mount (not on stateFilter change — filter is client-side)
	useEffect(() => {
		scanMutation.mutate({ projectId });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, scanMutation.mutate]);

	// Client-side author filter — instant, no re-fetch
	const filteredPrs = useMemo(
		() => filterPrsByAuthor(cachedPrsQuery.data ?? [], authorFilter),
		[cachedPrsQuery.data, authorFilter],
	);

	// ── Detail Layer ──

	// Cached detail from DB
	const cachedDetailQuery = trpc.pulse.getCachedPrDetail.useQuery(
		// biome-ignore lint/style/noNonNullAssertion: guarded by `enabled`
		{ projectId, number: selectedPrNumber! },
		{ enabled: selectedPrNumber !== null },
	);

	// Detail fetch mutation — writes DB, invalidates queries
	const detailMutation = trpc.pulse.fetchPrDetail.useMutation({
		onSuccess: (_data, variables) => {
			utils.pulse.getCachedPrDetail.invalidate({
				projectId,
				number: variables.number,
			});
			// Invalidate all getCachedPrs queries (all projects, all states).
			// The detail fetch refreshes list-level fields, and broad invalidation
			// is cheap (just marks queries stale for next access).
			utils.pulse.getCachedPrs.invalidate();
		},
	});

	// Auto-fetch detail on selection
	useEffect(() => {
		if (selectedPrNumber !== null) {
			detailMutation.mutate({ projectId, number: selectedPrNumber });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, selectedPrNumber, detailMutation.mutate]);

	// Derive loading states from unfiltered cache to avoid authorFilter affecting them
	const hasCachedData = (cachedPrsQuery.data?.length ?? 0) > 0;

	return {
		// List
		prs: filteredPrs,
		// First load: query has settled (empty or not) but DB has no data yet and mutation is running
		isLoading: deriveIsLoading(
			cachedPrsQuery.isLoading,
			hasCachedData,
			scanMutation.isPending,
		),
		isRefreshing: hasCachedData && scanMutation.isPending,
		scanError: scanMutation.error?.message ?? null,
		hasNextPage: scanMetaQuery.data?.hasNextPage ?? false,
		stateFilter,
		setStateFilter, // Instant — just changes the SQL WHERE, no re-fetch
		authorFilter,
		setAuthorFilter, // Instant — client-side Array.filter()
		scan: () => scanMutation.mutate({ projectId, cursor: null }),
		loadMore: () =>
			scanMutation.mutate({
				projectId,
				cursor: scanMetaQuery.data?.endCursor ?? null,
			}),

		// Detail
		selectedPrNumber,
		selectPr: setSelectedPrNumber,
		selectedPrDetail: cachedDetailQuery.data ?? null,
		// First load: query settled with null + mutation running = still loading
		isDetailLoading: deriveIsDetailLoading(
			selectedPrNumber,
			cachedDetailQuery.isLoading,
			cachedDetailQuery.data,
			detailMutation.isPending,
		),
		isDetailRefreshing: !!cachedDetailQuery.data && detailMutation.isPending,
		detailError: detailMutation.error?.message ?? null,
	};
}
