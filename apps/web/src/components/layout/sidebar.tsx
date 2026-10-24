import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Sidebar as BasaltSidebar,
	Button,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarIconItem,
	SidebarItem,
	SidebarNav,
	SidebarUser,
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
	PanelLeft,
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
import { avatarInitial } from "@/lib/avatar";
import { type NavGroupDef, visibleNavGroups } from "@/lib/navigation";
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
	userLabel,
	userEmail,
	userAvatarUrl,
	admin = false,
	tenantSwitcher,
	onToggle,
	onNavigate,
}: {
	collapsed: boolean;
	userLabel: string;
	userEmail?: string;
	userAvatarUrl?: string | null;
	admin?: boolean;
	tenantSwitcher?: ReactNode;
	onToggle: () => void;
	onNavigate?: () => void;
}) {
	const GROUPS = visibleNavGroups(admin).map(resolveGroup);
	const ALL_ITEMS = GROUPS.flatMap((group) => group.items);
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const workbench = useWorkbench();
	const initial = avatarInitial(userLabel);
	const go = (href: string) => {
		navigate(
			href === "/prs"
				? workbench.pullsHref
				: `${href}?source=${workbench.filter.source === "demo" ? "sample" : "live"}`,
		);
		onNavigate?.();
	};

	const avatar = (
		<Avatar className="h-9 w-9 shrink-0">
			{userAvatarUrl ? <AvatarImage src={userAvatarUrl} alt="" /> : null}
			<AvatarFallback className="bg-basalt-primary/15 text-xs text-basalt-primary">
				{initial}
			</AvatarFallback>
		</Avatar>
	);

	return (
		<BasaltSidebar collapsed={collapsed}>
			<SidebarHeader className="gap-basalt-space-lg overflow-hidden">
				<img
					src="/logo-64.png"
					alt="signoff.now"
					width={28}
					height={28}
					className="h-7 w-7 shrink-0 object-contain"
				/>
				{!collapsed ? (
					<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-basalt-space-lg">
							<span className="truncate text-lg font-semibold text-basalt-foreground">
								signoff
							</span>
							<span className="shrink-0 rounded-md bg-basalt-secondary px-basalt-space-md py-basalt-space-xs font-mono text-[10px] leading-none font-medium text-basalt-muted-foreground">
								v{__APP_VERSION__}
							</span>
						</div>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 shrink-0"
							onClick={onToggle}
							aria-label={onNavigate ? "Close navigation" : "Collapse sidebar"}
						>
							<PanelLeft className="h-4 w-4" aria-hidden strokeWidth={1.5} />
						</Button>
					</div>
				) : null}
			</SidebarHeader>

			{collapsed ? (
				<>
					<Button
						variant="ghost"
						size="icon"
						className="mb-basalt-space-sm self-center"
						onClick={onToggle}
						aria-label="Expand sidebar"
					>
						<PanelLeft className="h-4 w-4" aria-hidden strokeWidth={1.5} />
					</Button>
					<SidebarNav>
						{ALL_ITEMS.map((item) => {
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
						})}
					</SidebarNav>
					<SidebarFooter>
						<CollectionStatus collapsed />
						<Tooltip delayDuration={0}>
							<TooltipTrigger asChild>
								<span
									className="inline-flex"
									role="img"
									aria-label={
										userEmail ? `${userLabel}, ${userEmail}` : userLabel
									}
								>
									{avatar}
								</span>
							</TooltipTrigger>
							<TooltipContent side="right" sideOffset={8}>
								{userLabel}
							</TooltipContent>
						</Tooltip>
					</SidebarFooter>
				</>
			) : (
				<>
					<SidebarNav>
						{GROUPS.map((group) => (
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
					<SidebarFooter>
						{tenantSwitcher}
						<NetworkActivity />
						<CollectionStatus />
						<SidebarUser
							name={userLabel}
							email={userEmail ?? "local session"}
							avatar={avatar}
						/>
					</SidebarFooter>
				</>
			)}
		</BasaltSidebar>
	);
}
