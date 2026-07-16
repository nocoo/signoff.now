import {
	Activity,
	GitBranch,
	LayoutDashboard,
	Settings,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

const NAV = [
	{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
	{ to: "/developers", label: "Developers", icon: Users },
	{ to: "/teams", label: "Teams", icon: UsersRound },
	{ to: "/tags", label: "Tags", icon: Tag },
	{ to: "/repos", label: "Repos", icon: GitBranch },
	{ to: "/activity", label: "Activity", icon: Activity },
	{ to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({
	collapsed,
	userLabel,
}: {
	collapsed: boolean;
	userLabel: string;
}) {
	return (
		<aside
			className={cn(
				"flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
				collapsed ? "w-16" : "w-56",
			)}
		>
			<div
				className={cn(
					"flex h-14 items-center border-b border-sidebar-border px-4",
					collapsed && "justify-center px-2",
				)}
			>
				<span className="font-display text-sm font-semibold tracking-wide">
					{collapsed ? "S" : "signoff.now"}
				</span>
			</div>
			<nav className="flex flex-1 flex-col gap-1 p-2">
				{NAV.map((item) => (
					<NavLink
						key={item.to}
						to={item.to}
						end={item.end}
						className={({ isActive }) =>
							cn(
								"flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
								isActive
									? "bg-sidebar-accent text-sidebar-accent-foreground"
									: "hover:bg-sidebar-accent/60",
								collapsed && "justify-center px-2",
							)
						}
						title={item.label}
					>
						<item.icon className="h-4 w-4 shrink-0" />
						{!collapsed && <span>{item.label}</span>}
					</NavLink>
				))}
			</nav>
			<div
				className={cn(
					"border-t border-sidebar-border p-3 text-xs text-muted-foreground",
					collapsed && "text-center",
				)}
			>
				{collapsed ? "…" : userLabel || ""}
			</div>
		</aside>
	);
}
