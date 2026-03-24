/**
 * PullRequestsTab — two-panel email-style layout for PR browsing.
 *
 * Owns all pulse data: scan mutation + cached report.
 * Passes the unified report and scan controls down to child panels
 * so both panels always see the same data.
 */

import type { PrsReport } from "@signoff/pulse";
import { useState } from "react";
import { trpc } from "../../../lib/trpc";
import { PrDetailPanel } from "./pr/PrDetailPanel";
import { PrListPanel } from "./pr/PrListPanel";

interface PullRequestsTabProps {
	projectId: string;
}

export function PullRequestsTab({ projectId }: PullRequestsTabProps) {
	const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

	// Single source of truth for PR data
	const { data: cachedReport, refetch: refetchCached } =
		trpc.pulse.getCachedReport.useQuery({ projectId });

	const scanMutation = trpc.pulse.fetchPrs.useMutation({
		onSuccess: () => {
			refetchCached();
		},
	});

	// Merge: mutation result takes priority over stale cache
	const report: PrsReport | null = scanMutation.data ?? cachedReport ?? null;
	const isScanning = scanMutation.isPending;
	const scanError = scanMutation.error;

	// Resolve selected PR from the unified report
	const selectedPr =
		report?.prs.find((pr) => pr.number === selectedPrNumber) ?? null;

	const handleScan = (opts: {
		state: "open" | "closed" | "all";
		author: string | null;
	}) => {
		scanMutation.mutate({
			projectId,
			state: opts.state,
			author: opts.author,
		});
	};

	return (
		<div className="flex h-full overflow-hidden">
			{/* Left panel: PR list (40% width) */}
			<div className="w-2/5 min-w-[280px] max-w-[420px]">
				<PrListPanel
					report={report}
					isScanning={isScanning}
					scanError={scanError?.message ?? null}
					onScan={handleScan}
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
