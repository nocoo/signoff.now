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
	/** Shown only to administrators (and trusted local sessions). */
	admin?: boolean;
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
			{ href: "/sm", label: "State machines", icon: "Network" },
			{ href: "/prs", label: "Pull requests", icon: "GitPullRequest" },
			{ href: "/collections", label: "Collections", icon: "Layers3" },
			{ href: "/repos", label: "Repos", icon: "GitBranch" },
			{ href: "/projects", label: "Projects", icon: "FolderGit2" },
		],
	},
	{
		label: "Directory",
		defaultOpen: false,
		items: [
			{ href: "/developers", label: "Members", icon: "Users" },
			{ href: "/teams", label: "Teams", icon: "UsersRound" },
			{ href: "/tags", label: "Tags", icon: "Tag" },
		],
	},
	{
		label: "Insights",
		defaultOpen: false,
		items: [
			{ href: "/insights", label: "Contributions", icon: "LayoutDashboard" },
		],
	},
	{
		label: "System",
		defaultOpen: true,
		items: [
			{
				href: "/policy-instructions",
				label: "Policy instructions",
				icon: "ListOrdered",
			},
			{
				href: "/ai-settings",
				label: "AI Settings",
				icon: "Sparkles",
				admin: true,
			},
			{ href: "/settings", label: "Settings", icon: "Settings", admin: true },
			{
				href: "/admin",
				label: "Administration",
				icon: "ShieldCheck",
				admin: true,
			},
		],
	},
];

export function visibleNavGroups(admin: boolean): NavGroupDef[] {
	return NAV_GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) => admin || !item.admin),
	})).filter((group) => group.items.length > 0);
}

export interface BreadcrumbItem {
	label: string;
	href?: string;
}

export function breadcrumbsFromPathname(pathname: string): BreadcrumbItem[] {
	const path = (pathname.replace(/\/+$/, "") || "/prs").replace(
		/^\/state-machines(?=\/|$)/,
		"/sm",
	);
	for (const group of NAV_GROUPS) {
		const item = group.items.find(
			(candidate) =>
				candidate.href === path || path.startsWith(`${candidate.href}/`),
		);
		if (item) return [{ label: group.label }, { label: item.label }];
	}
	return [{ label: path.slice(path.lastIndexOf("/") + 1) }];
}
