/**
 * GitInfoDashboard — tabbed dashboard layout with data fetching.
 *
 * Renders when a project is selected and no mosaic panes are open.
 * Fetches the gitinfo report via tRPC, displays 6 tabs:
 * Overview, Contributors, Activity, Branches, Files, Tags.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@signoff/ui/tabs";
import {
	Activity,
	FileText,
	GitBranch,
	LayoutDashboard,
	Tag,
	Users,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
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
		<Tabs
			defaultValue="overview"
			className="flex h-full flex-col overflow-hidden"
		>
			<div className="shrink-0 border-b border-border px-6 pt-4">
				<TabsList>
					<TabsTrigger value="overview">
						<LayoutDashboard className="h-3.5 w-3.5" />
						Overview
					</TabsTrigger>
					<TabsTrigger value="contributors">
						<Users className="h-3.5 w-3.5" />
						Contributors
					</TabsTrigger>
					<TabsTrigger value="activity">
						<Activity className="h-3.5 w-3.5" />
						Activity
					</TabsTrigger>
					<TabsTrigger value="branches">
						<GitBranch className="h-3.5 w-3.5" />
						Branches
					</TabsTrigger>
					<TabsTrigger value="files">
						<FileText className="h-3.5 w-3.5" />
						Files
					</TabsTrigger>
					<TabsTrigger value="tags">
						<Tag className="h-3.5 w-3.5" />
						Tags
					</TabsTrigger>
				</TabsList>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				<div className="mx-auto max-w-5xl">
					<TabsContent value="overview">
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
					</TabsContent>
					<TabsContent value="contributors">
						<ContributorsTab contributors={report.contributors} />
					</TabsContent>
					<TabsContent value="activity">
						<ActivityTab logs={report.logs} />
					</TabsContent>
					<TabsContent value="branches">
						<BranchesTab branches={report.branches} />
					</TabsContent>
					<TabsContent value="files">
						<FilesTab files={report.files} />
					</TabsContent>
					<TabsContent value="tags">
						<TagsTab tags={report.tags} />
					</TabsContent>
				</div>
			</div>
		</Tabs>
	);
}
