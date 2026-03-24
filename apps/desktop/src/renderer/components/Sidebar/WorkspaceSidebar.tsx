/**
 * WorkspaceSidebar — left panel showing projects and dashboard pages.
 *
 * Supports:
 * - Expanded view (220-400px) with project/page tree
 * - Collapsed icon-only view (52px)
 * - Real project list from tRPC
 * - Add project dialog
 *
 * Resize is handled by parent ResizablePanel — this component only renders content.
 */

import { Button } from "@signoff/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@signoff/ui/dialog";
import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { cn } from "@signoff/ui/utils";
import {
	Activity,
	ChevronDown,
	FileText,
	FolderGit2,
	GitBranch,
	GitPullRequest,
	LayoutDashboard,
	Plus,
	RefreshCw,
	Tag,
	Users,
} from "lucide-react";
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import {
	type DashboardPage,
	useActiveWorkspaceStore,
} from "../../stores/active-workspace";

const PROJECT_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
	"#06b6d4",
];

const DASHBOARD_PAGES: {
	id: DashboardPage;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}[] = [
	{ id: "overview", label: "Overview", icon: LayoutDashboard },
	{ id: "contributors", label: "Contributors", icon: Users },
	{ id: "activity", label: "Activity", icon: Activity },
	{ id: "branches", label: "Branches", icon: GitBranch },
	{ id: "files", label: "Files", icon: FileText },
	{ id: "tags", label: "Tags", icon: Tag },
	{ id: "pull-requests", label: "Pull Requests", icon: GitPullRequest },
];

interface WorkspaceSidebarProps {
	isCollapsed: boolean;
}

export function WorkspaceSidebar({ isCollapsed }: WorkspaceSidebarProps) {
	const activeProjectId = useActiveWorkspaceStore((s) => s.activeProjectId);

	const utils = trpc.useUtils();
	const refreshMutation = trpc.gitinfo.refresh.useMutation({
		onSuccess: () => {
			if (activeProjectId) {
				utils.gitinfo.getReport.invalidate({ projectId: activeProjectId });
			}
		},
	});

	const handleRefresh = () => {
		if (activeProjectId) {
			refreshMutation.mutate({ projectId: activeProjectId });
		}
	};
	const isRefreshing = refreshMutation.isPending;

	return (
		<div
			className="flex h-full flex-col bg-muted/45"
			data-testid="workspace-sidebar"
		>
			{/* Header */}
			<div className="flex h-10 items-center justify-between px-3">
				{!isCollapsed && (
					<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Projects
					</span>
				)}
				<div className="flex items-center gap-0.5">
					{activeProjectId !== null && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 text-muted-foreground hover:text-foreground"
									onClick={handleRefresh}
									disabled={isRefreshing}
									data-testid="refresh-gitinfo-btn"
								>
									<RefreshCw
										className={cn("h-4 w-4", isRefreshing && "animate-spin")}
									/>
								</Button>
							</TooltipTrigger>
							<TooltipContent side="right">Refresh Git Info</TooltipContent>
						</Tooltip>
					)}
				</div>
			</div>

			{/* Project list */}
			<ScrollArea className={cn("flex-1", isCollapsed ? "px-1" : "px-2")}>
				{isCollapsed ? <CollapsedProjectList /> : <ExpandedProjectList />}
			</ScrollArea>

			{/* Footer: add project */}
			<div className="border-t border-border p-2">
				<AddProjectButton collapsed={isCollapsed} />
			</div>
		</div>
	);
}

/** Collapsed view — icon per project. */
function CollapsedProjectList() {
	const { data: projectList } = trpc.projects.list.useQuery();
	const activeProjectId = useActiveWorkspaceStore((s) => s.activeProjectId);
	const setActiveProjectId = useActiveWorkspaceStore(
		(s) => s.setActiveProjectId,
	);

	if (!projectList?.length) {
		return (
			<div className="flex flex-col items-center gap-2 pt-3">
				<div className="rounded p-2 text-muted-foreground hover:bg-accent">
					<FolderGit2 className="h-5 w-5" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-2 pt-3">
			{projectList.map(
				(project: { id: string; name: string; color: string }) => (
					<Tooltip key={project.id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								className={cn(
									"flex h-9 w-9 items-center justify-center rounded-md text-sm font-semibold text-white transition-colors hover:opacity-90",
									activeProjectId === project.id &&
										"ring-2 ring-primary ring-offset-2 ring-offset-background",
								)}
								style={{ backgroundColor: project.color }}
								onClick={() => setActiveProjectId(project.id)}
							>
								{project.name.charAt(0).toUpperCase()}
							</button>
						</TooltipTrigger>
						<TooltipContent side="right">{project.name}</TooltipContent>
					</Tooltip>
				),
			)}
		</div>
	);
}

/** Expanded view — project tree with dashboard pages. */
function ExpandedProjectList() {
	const { data: projectList, isLoading } = trpc.projects.list.useQuery();
	const expandedProjectId = useActiveWorkspaceStore((s) => s.expandedProjectId);
	const setExpandedProjectId = useActiveWorkspaceStore(
		(s) => s.setExpandedProjectId,
	);
	const setActiveProjectId = useActiveWorkspaceStore(
		(s) => s.setActiveProjectId,
	);

	if (isLoading) {
		return (
			<div className="py-2 text-center text-xs text-muted-foreground">
				Loading…
			</div>
		);
	}

	if (!projectList?.length) {
		return (
			<div
				className="py-2 text-center text-xs text-muted-foreground"
				data-testid="no-projects"
			>
				No projects yet
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5 py-1">
			{projectList.map(
				(project: { id: string; name: string; color: string }) => (
					<ProjectItem
						key={project.id}
						project={project}
						isExpanded={expandedProjectId === project.id}
						onToggle={() => {
							const isExpanding = expandedProjectId !== project.id;
							setExpandedProjectId(isExpanding ? project.id : null);
							// Always set activeProjectId on click (dashboard stays even on collapse)
							setActiveProjectId(project.id);
						}}
					/>
				),
			)}
		</div>
	);
}

/** Single project row with expandable page list. */
function ProjectItem({
	project,
	isExpanded,
	onToggle,
}: {
	project: { id: string; name: string; color: string };
	isExpanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div>
			{/* biome-ignore lint/a11y/useSemanticElements: div used instead of button to support keyboard interaction */}
			<div
				role="button"
				tabIndex={0}
				onClick={onToggle}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggle();
					}
				}}
				className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md pl-3 pr-2 py-1.5 text-left text-sm hover:bg-accent"
				data-testid={`project-item-${project.id}`}
			>
				<div
					className="flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
					style={{ backgroundColor: project.color }}
				>
					{project.name.charAt(0).toUpperCase()}
				</div>
				<span className="min-w-0 flex-1 truncate font-medium">
					{project.name}
				</span>
				<ChevronDown
					className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`}
				/>
			</div>
			{isExpanded === true && <PageList projectId={project.id} />}
		</div>
	);
}

/** Dashboard page list for a project (shown when expanded). */
function PageList({ projectId }: { projectId: string }) {
	const activeProjectId = useActiveWorkspaceStore((s) => s.activeProjectId);
	const activePageId = useActiveWorkspaceStore((s) => s.activePageId);
	const setActivePageId = useActiveWorkspaceStore((s) => s.setActivePageId);
	const setActiveProjectId = useActiveWorkspaceStore(
		(s) => s.setActiveProjectId,
	);

	return (
		<div className="flex flex-col gap-0.5 py-0.5">
			{DASHBOARD_PAGES.map((page) => {
				const isActive =
					activeProjectId === projectId && activePageId === page.id;
				const Icon = page.icon;
				return (
					<button
						key={page.id}
						type="button"
						onClick={() => {
							setActiveProjectId(projectId);
							// setActiveProjectId resets to overview, so set page after
							setActivePageId(page.id);
						}}
						className={cn(
							"flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-left text-[13px]",
							isActive
								? "bg-accent font-medium text-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
						data-testid={`page-item-${page.id}`}
					>
						<span className="flex size-5 shrink-0 items-center justify-center">
							<Icon className="size-4" />
						</span>
						<span className="min-w-0 flex-1 truncate">{page.label}</span>
					</button>
				);
			})}
		</div>
	);
}

/** Add Project button + dialog. */
function AddProjectButton({ collapsed }: { collapsed: boolean }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [path, setPath] = useState("");
	const [color, setColor] = useState(PROJECT_COLORS[0]);

	const utils = trpc.useUtils();
	const createMutation = trpc.projects.create.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
			setOpen(false);
			setName("");
			setPath("");
			setColor(PROJECT_COLORS[0]);
		},
	});

	const openDirectoryMutation = trpc.window.openDirectory.useMutation();

	const handleBrowse = async () => {
		const result = await openDirectoryMutation.mutateAsync();
		if (result.path) {
			setPath(result.path);
			// Auto-fill name from folder basename if name is empty
			if (!name.trim()) {
				const folderName =
					result.path.split("/").pop() ?? result.path.split("\\").pop() ?? "";
				setName(folderName);
			}
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !path.trim()) return;
		createMutation.mutate({
			name: name.trim(),
			mainRepoPath: path.trim(),
			color,
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-center gap-1.5 text-xs text-muted-foreground"
					data-testid="add-project-btn"
				>
					<Plus className="h-3.5 w-3.5" />
					{!collapsed && <span>Add Project</span>}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Add Project</DialogTitle>
					<DialogDescription className="sr-only">
						Create a new project by providing a name, repository path, and
						color.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="project-name">Name</Label>
						<Input
							id="project-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Project"
							data-testid="project-name-input"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="project-path">Repository Path</Label>
						<div className="flex gap-2">
							<Input
								id="project-path"
								value={path}
								readOnly
								placeholder="Select a folder…"
								className="flex-1"
								data-testid="project-path-input"
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleBrowse}
								disabled={openDirectoryMutation.isPending}
							>
								Browse
							</Button>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<Label>Color</Label>
						<div className="flex gap-2">
							{PROJECT_COLORS.map((c) => (
								<button
									key={c}
									type="button"
									onClick={() => setColor(c)}
									className={`h-6 w-6 rounded-full border-2 ${
										color === c ? "border-foreground" : "border-transparent"
									}`}
									style={{ backgroundColor: c }}
									data-testid={`color-${c}`}
								/>
							))}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="submit"
							disabled={
								!name.trim() || !path.trim() || createMutation.isPending
							}
							data-testid="create-project-submit"
						>
							{createMutation.isPending ? "Creating…" : "Create Project"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
