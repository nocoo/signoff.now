/**
 * PullRequestsTab — two-panel email-style layout for PR browsing.
 *
 * TODO: Will be refactored in next commit to use usePrViewModel hook.
 * Currently uses the new DB-backed tRPC procedures directly.
 */

import { useState } from "react";
import { trpc } from "../../../lib/trpc";
import { PrDetailPanel } from "./pr/PrDetailPanel";
import { PrListPanel } from "./pr/PrListPanel";

interface PullRequestsTabProps {
	projectId: string;
}

export function PullRequestsTab({ projectId }: PullRequestsTabProps) {
	const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);

	// Read from DB (single source of truth)
	const cachedPrsQuery = trpc.pulse.getCachedPrs.useQuery({
		projectId,
		state: stateFilter,
	});

	const scanMetaQuery = trpc.pulse.getScanMeta.useQuery({ projectId });

	const scanMutation = trpc.pulse.fetchPrs.useMutation({
		onSuccess: () => {
			cachedPrsQuery.refetch();
			scanMetaQuery.refetch();
		},
	});

	const prs = cachedPrsQuery.data ?? [];
	const isScanning = scanMutation.isPending;
	const scanError = scanMutation.error;

	// Resolve selected PR from the list
	const selectedPr = prs.find((pr) => pr.number === selectedPrNumber) ?? null;

	const handleScan = (opts: {
		state: "open" | "closed" | "all";
		author: string | null;
	}) => {
		setStateFilter(opts.state);
		scanMutation.mutate({ projectId, cursor: null });
	};

	const handleLoadMore = () => {
		if (!scanMetaQuery.data?.hasNextPage || !scanMetaQuery.data.endCursor)
			return;
		scanMutation.mutate({
			projectId,
			cursor: scanMetaQuery.data.endCursor,
		});
	};

	// Build a minimal report-like shape for PrListPanel compatibility
	const report =
		prs.length > 0
			? {
					prs,
					totalCount: prs.length,
					hasNextPage: scanMetaQuery.data?.hasNextPage ?? false,
					endCursor: scanMetaQuery.data?.endCursor ?? null,
					generatedAt: "",
					durationMs: 0,
					repository: {
						owner: scanMetaQuery.data?.repoOwner ?? "",
						repo: scanMetaQuery.data?.repoName ?? "",
						url: "",
					},
					identity: {
						resolvedUser: scanMetaQuery.data?.resolvedUser ?? "",
						resolvedVia: (scanMetaQuery.data?.resolvedVia ?? "direct") as
							| "direct"
							| "org"
							| "fallback",
					},
					filters: {
						state: stateFilter,
						author: null as string | null,
						limit: 20,
					},
				}
			: null;

	return (
		<div className="flex h-full overflow-hidden">
			{/* Left panel: PR list (40% width) */}
			<div className="w-2/5 min-w-[280px] max-w-[420px]">
				<PrListPanel
					report={report}
					isScanning={isScanning}
					scanError={scanError?.message ?? null}
					onScan={handleScan}
					onLoadMore={handleLoadMore}
					selectedPr={selectedPrNumber}
					onSelectPr={setSelectedPrNumber}
				/>
			</div>

			{/* Right panel: PR detail (60% width) */}
			<div className="flex-1">
				<PrDetailPanel pr={selectedPr} />
			</div>
		</div>
	);
}
