import {
	Avatar,
	AvatarFallback,
	Badge,
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
	LayoutDashboard,
	Network,
	PanelLeft,
	Settings,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import type { ElementType } from "react";
import { useLocation, useNavigate } from "react-router";
import { avatarInitial } from "@/lib/avatar";
import { NAV_GROUPS, type NavGroupDef } from "@/lib/navigation";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { CollectionStatus } from "@/views/workbench/CollectionStatus";

const ICON_MAP: Record<string, ElementType> = {
	GitPullRequest,
	FolderGit2,
	LayoutDashboard,
	Network,
	Users,
	UsersRound,
	Tag,
	GitBranch,
	Activity,
	Settings,
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

const GROUPS = NAV_GROUPS.map(resolveGroup);
const ALL_ITEMS = GROUPS.flatMap((group) => group.items);

function isActivePath(pathname: string, item: NavItem): boolean {
	if (item.end || item.href === "/") return pathname === item.href;
	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Sidebar({
	collapsed,
	userLabel,
	userEmail,
	onToggle,
	onNavigate,
}: {
	collapsed: boolean;
	userLabel: string;
	userEmail?: string;
	onToggle: () => void;
	onNavigate?: () => void;
}) {
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
			<AvatarFallback className="bg-basalt-primary/15 text-xs text-basalt-primary">
				{initial}
			</AvatarFallback>
		</Avatar>
	);

	return (
		<BasaltSidebar collapsed={collapsed}>
			<SidebarHeader className="gap-3 overflow-hidden px-5">
				<img
					src="/logo-64.png"
					alt="signoff.now"
					width={28}
					height={28}
					className="h-7 w-7 shrink-0 object-contain"
				/>
				{!collapsed ? (
					<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-3">
							<span className="truncate text-lg font-semibold tracking-tight text-basalt-foreground">
								signoff
							</span>
							<Badge
								variant="secondary"
								className="shrink-0 px-1.5 py-0.5 text-[10px] leading-none"
							>
								v{__APP_VERSION__}
							</Badge>
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
						className="mb-1 self-center"
						onClick={onToggle}
						aria-label="Expand sidebar"
					>
						<PanelLeft className="h-4 w-4" aria-hidden strokeWidth={1.5} />
					</Button>
					<SidebarNav className="w-full items-center gap-1 pt-1">
						{ALL_ITEMS.map((item) => {
							const Icon = item.icon;
							return (
								<Tooltip key={item.href} delayDuration={0}>
									<TooltipTrigger asChild>
										<SidebarIconItem
											active={isActivePath(pathname, item)}
											aria-label={item.label}
											className="self-center"
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
					<SidebarFooter className="flex w-full flex-col items-center px-0">
						<CollectionStatus collapsed onExpand={onToggle} />
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
					<SidebarNav className="pt-1">
						{GROUPS.map((group) => (
							<SidebarGroup
								key={group.label}
								label={group.label}
								defaultOpen={group.defaultOpen}
							>
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
