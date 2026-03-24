/**
 * PullRequestsTab — two-panel email-style layout for PR browsing.
 *
 * Left panel: PR list with scan button and filters.
 * Right panel: selected PR detail view.
 *
 * Fetches data via pulse tRPC router (separate from gitinfo).
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

	// Resolve the selected PR from cached report
	const { data: cachedReport } = trpc.pulse.getCachedReport.useQuery({
		projectId,
	});

	const selectedPr =
		cachedReport?.prs.find((pr) => pr.number === selectedPrNumber) ?? null;

	return (
		<div className="flex h-full overflow-hidden">
			{/* Left panel: PR list (40% width) */}
			<div className="w-2/5 min-w-[280px] max-w-[420px]">
				<PrListPanel
					projectId={projectId}
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
