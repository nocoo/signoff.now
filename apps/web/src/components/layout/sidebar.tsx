import {
	Sidebar as BasaltSidebar,
	SidebarBrand,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarToggle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nocoo/basalt";
import {
	Activity,
	FolderGit2,
	GitBranch,
	GitPullRequest,
	Layers3,
	LayoutDashboard,
	ListOrdered,
	Network,
	PlugZap,
	Settings,
	ShieldCheck,
	Sparkles,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { type NavGroupDef, visibleNavGroups } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { CollectionStatus } from "@/views/workbench/CollectionStatus";
import { NetworkActivity } from "@/views/workbench/NetworkActivity";

const ICON_MAP: Record<string, ElementType> = {
	Layers3,
	GitPullRequest,
	FolderGit2,
	LayoutDashboard,
	ListOrdered,
	Network,
	Users,
	UsersRound,
	Tag,
	GitBranch,
	Activity,
	PlugZap,
	Settings,
	ShieldCheck,
	Sparkles,
};

type NavItem = {
	href: string;
	label: string;
	icon: ElementType;
	end?: boolean;
};

function resolveGroup(def: NavGroupDef) {
	return {
		...def,
		items: def.items.map((item) => ({
			...item,
			icon: ICON_MAP[item.icon] ?? Settings,
		})),
	};
}

function isActivePath(pathname: string, item: NavItem): boolean {
	if (item.end || item.href === "/") return pathname === item.href;
	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Sidebar({
	collapsed,
	admin = false,
	tenantSwitcher,
	resizable,
	onToggle,
	onNavigate,
}: {
	collapsed: boolean;
	admin?: boolean;
	tenantSwitcher?: ReactNode;
	resizable?: boolean;
	onToggle?: () => void;
	onNavigate?: () => void;
}) {
	const GROUPS = visibleNavGroups(admin).map(resolveGroup);
	const ALL_ITEMS = GROUPS.flatMap((group) => group.items);
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const workbench = useWorkbench();
	const go = (href: string) => {
		navigate(
			href === "/prs"
				? workbench.pullsHref
				: `${href}?source=${workbench.filter.source === "demo" ? "sample" : "live"}`,
		);
		onNavigate?.();
	};

	return (
		<BasaltSidebar collapsed={collapsed} resizable={resizable}>
			<SidebarHeader>
				<SidebarBrand
					logo={
						<img src="/logo-64.png" alt="signoff.now" width={24} height={24} />
					}
					name="signoff"
					version={`v${__APP_VERSION__}`}
					action={
						<SidebarToggle
							mode={onNavigate ? "dismiss" : "toggle"}
							onDismiss={onToggle}
						/>
					}
				/>
			</SidebarHeader>

			<SidebarNav>
				{collapsed
					? ALL_ITEMS.map((item) => {
							const Icon = item.icon;
							return (
								<Tooltip key={item.href} delayDuration={0}>
									<TooltipTrigger asChild>
										<SidebarIconItem
											active={isActivePath(pathname, item)}
											aria-label={item.label}
											onClick={() => go(item.href)}
										>
											<Icon className="h-4 w-4" aria-hidden strokeWidth={1.5} />
										</SidebarIconItem>
									</TooltipTrigger>
									<TooltipContent side="right" sideOffset={8}>
										{item.label}
									</TooltipContent>
								</Tooltip>
							);
						})
					: GROUPS.map((group) => (
							<SidebarGroup key={group.label} label={group.label} defaultOpen>
								{group.items.map((item) => {
									const Icon = item.icon;
									return (
										<SidebarItem
											key={item.href}
											active={isActivePath(pathname, item)}
											onClick={() => go(item.href)}
										>
											<Icon
												className="h-4 w-4 shrink-0"
												aria-hidden
												strokeWidth={1.5}
											/>
											<span className="flex-1 truncate text-left">
												{item.label}
											</span>
										</SidebarItem>
									);
								})}
							</SidebarGroup>
						))}
			</SidebarNav>
			<SidebarFooter
				className={cn("gap-1.5 pt-1 pb-2 md:pb-3", !collapsed && "px-2.5")}
			>
				{!collapsed && tenantSwitcher}
				{collapsed ? (
					<CollectionStatus collapsed />
				) : (
					<div data-slot="sidebar-telemetry" className="flex flex-col gap-1">
						<NetworkActivity />
						<CollectionStatus />
					</div>
				)}
			</SidebarFooter>
		</BasaltSidebar>
	);
}
