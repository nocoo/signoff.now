/**
 * WorkspaceSidebar — left panel showing projects and workspaces.
 *
 * Supports:
 * - Expanded view (220-400px) with project/workspace tree
 * - Collapsed icon-only view (52px)
 * - Drag to resize via mouse
 * - Toggle collapse via button
 * - Real project list from tRPC
 * - Add project dialog
 */

import { Button } from "@signoff/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@signoff/ui/dialog";
import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { ScrollArea } from "@signoff/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	FolderGit2,
	Plus,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useActiveWorkspaceStore } from "../../stores/active-workspace";
import {
	COLLAPSED_WORKSPACE_SIDEBAR_WIDTH,
	MAX_WORKSPACE_SIDEBAR_WIDTH,
	MIN_WORKSPACE_SIDEBAR_WIDTH,
	useWorkspaceSidebarStore,
} from "../../stores/workspace-sidebar-state";

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

export function WorkspaceSidebar() {
	const {
		isOpen,
		width,
		isResizing,
		setWidth,
		setIsResizing,
		toggleCollapsed,
		isCollapsed,
	} = useWorkspaceSidebarStore();

	const sidebarRef = useRef<HTMLDivElement>(null);
	const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
		null,
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setIsResizing(true);

			const startX = e.clientX;
			const startWidth = width;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const delta = moveEvent.clientX - startX;
				setWidth(startWidth + delta);
			};

			const handleMouseUp = () => {
				setIsResizing(false);
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
		},
		[width, setWidth, setIsResizing],
	);

	if (!isOpen) return null;

	const collapsed = isCollapsed();

	return (
		<div
			ref={sidebarRef}
			className="relative flex h-full flex-col border-r border-border bg-sidebar"
			style={{ width, minWidth: COLLAPSED_WORKSPACE_SIDEBAR_WIDTH }}
			data-testid="workspace-sidebar"
		>
			{/* Header */}
			<div className="flex h-10 items-center justify-between px-3">
				{!collapsed && (
					<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Projects
					</span>
				)}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={toggleCollapsed}
						>
							{collapsed ? (
								<ChevronRight className="h-4 w-4" />
							) : (
								<ChevronLeft className="h-4 w-4" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">
						{collapsed ? "Expand sidebar" : "Collapse sidebar"}
					</TooltipContent>
				</Tooltip>
			</div>

			{/* Project list */}
			<ScrollArea className="flex-1 px-2">
				{collapsed ? (
					<CollapsedProjectList />
				) : (
					<ExpandedProjectList
						expandedProjectId={expandedProjectId}
						onToggleProject={setExpandedProjectId}
					/>
				)}
			</ScrollArea>

			{/* Footer: add project */}
			<div className="border-t border-border p-2">
				<AddProjectButton collapsed={collapsed} />
			</div>

			{/* Resize handle */}
			{!collapsed && (
				// biome-ignore lint/a11y/useSemanticElements: <hr> cannot serve as a vertical resize handle with absolute positioning
				<div
					role="separator"
					tabIndex={0}
					aria-orientation="vertical"
					aria-valuenow={width}
					aria-valuemin={MIN_WORKSPACE_SIDEBAR_WIDTH}
					aria-valuemax={MAX_WORKSPACE_SIDEBAR_WIDTH}
					className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20"
					onMouseDown={handleMouseDown}
					data-testid="workspace-sidebar-resize"
					style={{
						opacity: isResizing ? 1 : undefined,
						backgroundColor: isResizing
							? "hsl(var(--primary) / 0.3)"
							: undefined,
					}}
				/>
			)}
		</div>
	);
}

/** Collapsed view — icon per project. */
function CollapsedProjectList() {
	const { data: projectList } = trpc.projects.list.useQuery();

	if (!projectList?.length) {
		return (
			<div className="flex flex-col items-center gap-2 pt-2">
				<div className="rounded p-2 text-muted-foreground hover:bg-accent">
					<FolderGit2 className="h-5 w-5" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-1 pt-2">
			{projectList.map(
				(project: { id: string; name: string; color: string }) => (
					<Tooltip key={project.id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								className="flex h-8 w-8 items-center justify-center rounded text-xs font-bold text-white"
								style={{ backgroundColor: project.color }}
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

/** Expanded view — project tree with workspaces. */
function ExpandedProjectList({
	expandedProjectId,
	onToggleProject,
}: {
	expandedProjectId: string | null;
	onToggleProject: (id: string | null) => void;
}) {
	const { data: projectList, isLoading } = trpc.projects.list.useQuery();

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
				(project: {
					id: string;
					name: string;
					color: string;
					mainRepoPath: string;
				}) => (
					<ProjectItem
						key={project.id}
						project={project}
						isExpanded={expandedProjectId === project.id}
						onToggle={() =>
							onToggleProject(
								expandedProjectId === project.id ? null : project.id,
							)
						}
					/>
				),
			)}
		</div>
	);
}

/** Single project row with expandable workspace list. */
function ProjectItem({
	project,
	isExpanded,
	onToggle,
}: {
	project: {
		id: string;
		name: string;
		color: string;
		mainRepoPath: string;
	};
	isExpanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div>
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
				data-testid={`project-item-${project.id}`}
			>
				<div
					className="h-3 w-3 shrink-0 rounded-sm"
					style={{ backgroundColor: project.color }}
				/>
				<span className="min-w-0 flex-1 truncate">{project.name}</span>
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`}
				/>
			</button>
			{isExpanded && (
				<WorkspaceList
					projectId={project.id}
					mainRepoPath={project.mainRepoPath}
				/>
			)}
		</div>
	);
}

/** Workspace list for a project (fetched on expand). */
function WorkspaceList({
	projectId,
	mainRepoPath,
}: {
	projectId: string;
	mainRepoPath: string;
}) {
	const { data: workspaceList, isLoading } = trpc.workspaces.list.useQuery({
		projectId,
	});
	const setActiveMutation = trpc.workspaces.setActive.useMutation();
	const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);
	const setActiveWorkspace = useActiveWorkspaceStore(
		(s) => s.setActiveWorkspace,
	);

	const handleActivate = useCallback(
		(ws: {
			id: string;
			name: string;
			branch: string;
			worktree?: { path: string } | null;
		}) => {
			// Use worktree path when available, fall back to project's main repo
			const workspacePath = ws.worktree?.path ?? mainRepoPath;
			setActiveWorkspace({
				id: ws.id,
				projectId,
				workspacePath,
				branch: ws.branch,
				name: ws.name || ws.branch,
			});
			setActiveMutation.mutate({ id: ws.id });
		},
		[projectId, mainRepoPath, setActiveWorkspace, setActiveMutation],
	);

	if (isLoading) {
		return (
			<div className="py-1 pl-7 text-xs text-muted-foreground">Loading…</div>
		);
	}

	if (!workspaceList?.length) {
		return (
			<div className="py-1 pl-7 text-xs text-muted-foreground">
				No workspaces
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5 py-0.5">
			{workspaceList.map(
				(ws: {
					id: string;
					name: string;
					branch: string;
					worktree?: { path: string } | null;
				}) => {
					const isActive = activeWorkspace?.id === ws.id;
					return (
						<button
							key={ws.id}
							type="button"
							onClick={() => handleActivate(ws)}
							className={`flex items-center gap-1.5 rounded py-1 pl-7 pr-2 text-left text-xs ${
								isActive
									? "bg-accent text-foreground font-medium"
									: "hover:bg-accent"
							}`}
							data-testid={`workspace-item-${ws.id}`}
						>
							<span className="min-w-0 flex-1 truncate">
								{ws.name || ws.branch}
							</span>
						</button>
					);
				},
			)}
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
						<Input
							id="project-path"
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="/path/to/repo"
							data-testid="project-path-input"
						/>
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
