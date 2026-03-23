/**
 * GitInfoDashboard — main dashboard layout with data fetching.
 *
 * Renders when a project is selected and no mosaic panes are open.
 * Fetches the gitinfo report via tRPC, displays 8 cards in a 2-column grid.
 */

import { trpc } from "../../lib/trpc";
import { ActivityCard } from "./ActivityCard";
import { BranchesCard } from "./BranchesCard";
import { ConfigCard } from "./ConfigCard";
import { ContributorsCard } from "./ContributorsCard";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { FilesCard } from "./FilesCard";
import { OverviewCard } from "./OverviewCard";
import { StatusCard } from "./StatusCard";
import { TagsCard } from "./TagsCard";

interface GitInfoDashboardProps {
	projectId: string;
}

export function GitInfoDashboard({ projectId }: GitInfoDashboardProps) {
	const {
		data: report,
		isLoading,
		error,
	} = trpc.gitinfo.getReport.useQuery(
		{ projectId },
		{ enabled: Boolean(projectId), staleTime: Number.POSITIVE_INFINITY },
	);

	if (isLoading) return <DashboardSkeleton />;

	if (error) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<div className="text-center">
					<p className="text-sm font-medium text-destructive">
						Failed to load repository info
					</p>
					<p className="mt-1 text-xs">{error.message}</p>
				</div>
			</div>
		);
	}

	if (!report) return null;

	return (
		<div className="h-full overflow-y-auto p-6">
			{/* CSS columns masonry: cards fill naturally based on their content height */}
			<div className="mx-auto max-w-6xl columns-1 gap-4 md:columns-2 lg:columns-3">
				<div className="mb-4 break-inside-avoid">
					<OverviewCard
						meta={report.meta}
						logs={report.logs}
						status={report.status}
						config={report.config}
					/>
				</div>
				<div className="mb-4 break-inside-avoid">
					<StatusCard status={report.status} />
				</div>
				<div className="mb-4 break-inside-avoid">
					<BranchesCard branches={report.branches} />
				</div>
				<div className="mb-4 break-inside-avoid">
					<ContributorsCard contributors={report.contributors} />
				</div>
				<div className="mb-4 break-inside-avoid">
					<ActivityCard logs={report.logs} />
				</div>
				<div className="mb-4 break-inside-avoid">
					<FilesCard files={report.files} />
				</div>
				<div className="mb-4 break-inside-avoid">
					<TagsCard tags={report.tags} />
				</div>
				<div className="mb-4 break-inside-avoid">
					<ConfigCard config={report.config} />
				</div>
			</div>
		</div>
	);
}
