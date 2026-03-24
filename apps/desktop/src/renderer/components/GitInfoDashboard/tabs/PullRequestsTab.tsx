/**
 * PullRequestsTab — two-panel email-style layout for PR browsing.
 *
 * Delegates all data management to usePrViewModel. This component
 * is purely a layout coordinator: it passes ViewModel data down to
 * the two panels and wires up callbacks.
 */

import { usePrViewModel } from "../../../hooks/usePrViewModel";
import { PrDetailPanel } from "./pr/PrDetailPanel";
import { PrListPanel } from "./pr/PrListPanel";

interface PullRequestsTabProps {
	projectId: string;
}

export function PullRequestsTab({ projectId }: PullRequestsTabProps) {
	const vm = usePrViewModel(projectId);

	return (
		<div className="flex h-full overflow-hidden">
			{/* Left panel: PR list (40% width) */}
			<div className="w-2/5 min-w-[280px] max-w-[420px]">
				<PrListPanel
					prs={vm.prs}
					isLoading={vm.isLoading}
					isRefreshing={vm.isRefreshing}
					scanError={vm.scanError}
					hasNextPage={vm.hasNextPage}
					stateFilter={vm.stateFilter}
					onStateFilterChange={vm.setStateFilter}
					authorFilter={vm.authorFilter}
					onAuthorFilterChange={vm.setAuthorFilter}
					onScan={vm.scan}
					onLoadMore={vm.loadMore}
					selectedPr={vm.selectedPrNumber}
					onSelectPr={vm.selectPr}
				/>
			</div>

			{/* Right panel: PR detail (60% width) */}
			<div className="flex-1">
				<PrDetailPanel
					detail={vm.selectedPrDetail}
					hasSelection={vm.selectedPrNumber !== null}
					isLoading={vm.isDetailLoading}
					isRefreshing={vm.isDetailRefreshing}
					error={vm.detailError}
				/>
			</div>
		</div>
	);
}
