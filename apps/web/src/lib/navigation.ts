/**
 * Navigation config for the dashboard shell.
 * Pure data — no React dependency (Basalt B-2 / pew pattern).
 */

export interface NavItemDef {
	href: string;
	label: string;
	/** Lucide icon name resolved in sidebar.tsx */
	icon: string;
	end?: boolean;
}

export interface NavGroupDef {
	label: string;
	items: NavItemDef[];
	defaultOpen?: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
	{
		label: "Workspace",
		defaultOpen: true,
		items: [
			{ href: "/", label: "Pull requests", icon: "GitPullRequest", end: true },
			{ href: "/projects", label: "Projects", icon: "FolderGit2" },
		],
	},
	{
		label: "Directory",
		defaultOpen: false,
		items: [
			{ href: "/developers", label: "Developers", icon: "Users" },
			{ href: "/teams", label: "Teams", icon: "UsersRound" },
			{ href: "/tags", label: "Tags", icon: "Tag" },
			{ href: "/repos", label: "Repos", icon: "GitBranch" },
		],
	},
	{
		label: "Insights",
		defaultOpen: false,
		items: [
			{ href: "/insights", label: "Dashboard", icon: "LayoutDashboard" },
			{ href: "/activity", label: "Activity", icon: "Activity" },
		],
	},
	{
		label: "System",
		defaultOpen: true,
		items: [{ href: "/settings", label: "Settings", icon: "Settings" }],
	},
];

export interface BreadcrumbItem {
	label: string;
	href?: string;
}

export function breadcrumbsFromPathname(pathname: string): BreadcrumbItem[] {
	const path = pathname.replace(/\/+$/, "") || "/";
	for (const group of NAV_GROUPS) {
		const item = group.items.find((candidate) => candidate.href === path);
		if (item) return [{ label: group.label }, { label: item.label }];
	}
	return [{ label: path.slice(path.lastIndexOf("/") + 1) }];
}
