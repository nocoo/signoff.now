/**
 * GitInfoDashboard — page-driven dashboard layout with data fetching.
 *
 * Renders when a project is selected and no mosaic panes are open.
 * Fetches the gitinfo report via tRPC, displays the active page
 * as determined by activePageId in the workspace store.
 */

import { trpc } from "../../lib/trpc";
import { useActiveWorkspaceStore } from "../../stores/active-workspace";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { ActivityTab } from "./tabs/ActivityTab";
import { BranchesTab } from "./tabs/BranchesTab";
import { ContributorsTab } from "./tabs/ContributorsTab";
import { FilesTab } from "./tabs/FilesTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { TagsTab } from "./tabs/TagsTab";

interface GitInfoDashboardProps {
	projectId: string;
}

export function GitInfoDashboard({ projectId }: GitInfoDashboardProps) {
	const activePageId = useActiveWorkspaceStore((s) => s.activePageId);

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
			<div className="mx-auto max-w-5xl">
				{activePageId === "overview" && (
					<OverviewTab
						meta={report.meta}
						logs={report.logs}
						status={report.status}
						config={report.config}
						files={report.files}
						contributors={report.contributors}
						branches={report.branches}
						tags={report.tags}
					/>
				)}
				{activePageId === "contributors" && (
					<ContributorsTab contributors={report.contributors} />
				)}
				{activePageId === "activity" && <ActivityTab logs={report.logs} />}
				{activePageId === "branches" && (
					<BranchesTab branches={report.branches} />
				)}
				{activePageId === "files" && <FilesTab files={report.files} />}
				{activePageId === "tags" && <TagsTab tags={report.tags} />}
			</div>
		</div>
	);
}
