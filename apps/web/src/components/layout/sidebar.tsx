import {
	Activity,
	ChevronUp,
	GitBranch,
	LayoutDashboard,
	PanelLeft,
	Settings,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import { type ElementType, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_GROUPS, type NavGroupDef } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";

const ICON_MAP: Record<string, ElementType> = {
	LayoutDashboard,
	Users,
	UsersRound,
	Tag,
	GitBranch,
	Activity,
	Settings,
};

interface NavItem {
	href: string;
	label: string;
	icon: ElementType;
	end?: boolean;
}

interface NavGroup {
	label: string;
	items: NavItem[];
	defaultOpen?: boolean;
}

function resolveGroup(def: NavGroupDef): NavGroup {
	return {
		label: def.label,
		defaultOpen: def.defaultOpen,
		items: def.items.map((item) => ({
			href: item.href,
			label: item.label,
			end: item.end,
			icon: ICON_MAP[item.icon] ?? Settings,
		})),
	};
}

const GROUPS = NAV_GROUPS.map(resolveGroup);
const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

function isActivePath(pathname: string, item: NavItem): boolean {
	if (item.end || item.href === "/") {
		return pathname === item.href;
	}
	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavGroupSection({
	group,
	pathname,
}: {
	group: NavGroup;
	pathname: string;
}) {
	const [open, setOpen] = useState(group.defaultOpen ?? true);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<div className="px-3 mt-2">
				<CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2">
					<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
						{group.label}
					</span>
					<span className="flex h-5 w-5 shrink-0 items-center justify-center">
						<ChevronUp
							className={cn(
								"h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200",
								!open && "rotate-180",
							)}
							strokeWidth={1.5}
						/>
					</span>
				</CollapsibleTrigger>
			</div>
			<div
				className="grid overflow-hidden"
				style={{
					gridTemplateRows: open ? "1fr" : "0fr",
					transition: "grid-template-rows 200ms ease-out",
				}}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="flex flex-col gap-0.5 px-3">
						{group.items.map((item) => {
							const active = isActivePath(pathname, item);
							return (
								<Link
									key={item.href}
									to={item.href}
									className={cn(
										"flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
										active
											? "bg-accent text-foreground"
											: "text-muted-foreground hover:bg-accent hover:text-foreground",
									)}
								>
									<item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
									<span className="flex-1 text-left">{item.label}</span>
								</Link>
							);
						})}
					</div>
				</div>
			</div>
		</Collapsible>
	);
}

function CollapsedNavItem({
	item,
	pathname,
}: {
	item: NavItem;
	pathname: string;
}) {
	const active = isActivePath(pathname, item);
	return (
		<Tooltip delayDuration={0}>
			<TooltipTrigger asChild>
				<Link
					to={item.href}
					className={cn(
						"relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
						active
							? "bg-accent text-foreground"
							: "text-muted-foreground hover:bg-accent hover:text-foreground",
					)}
				>
					<item.icon className="h-4 w-4" strokeWidth={1.5} />
				</Link>
			</TooltipTrigger>
			<TooltipContent side="right" sideOffset={8}>
				{item.label}
			</TooltipContent>
		</Tooltip>
	);
}

export function Sidebar({
	userLabel,
	userEmail,
}: {
	userLabel: string;
	userEmail?: string;
}) {
	const { pathname } = useLocation();
	const { collapsed, toggle } = useSidebar();
	const initial = (userLabel[0] ?? "S").toUpperCase();

	// Persist collapse preference lightly
	useEffect(() => {
		const stored = localStorage.getItem("signoff-sidebar-collapsed");
		if (stored === "1" && !collapsed) {
			// only apply once on mount via parent — skip if already toggled
		}
	}, [collapsed]);

	return (
		<TooltipProvider delayDuration={0}>
			<aside
				className={cn(
					"sticky top-0 flex h-screen shrink-0 flex-col bg-background transition-all duration-300 ease-in-out overflow-hidden",
					collapsed ? "w-[68px]" : "w-[260px]",
				)}
			>
				{collapsed ? (
					<div className="flex h-screen w-[68px] flex-col items-center">
						<div className="flex h-14 items-center justify-center">
							<span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
								S
							</span>
						</div>
						<button
							type="button"
							onClick={() => {
								toggle();
								localStorage.setItem("signoff-sidebar-collapsed", "0");
							}}
							aria-label="Expand sidebar"
							className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-1"
						>
							<PanelLeft className="h-4 w-4" aria-hidden strokeWidth={1.5} />
						</button>
						<nav className="flex-1 flex w-full flex-col items-center gap-1 overflow-y-auto pt-1">
							{ALL_ITEMS.map((item) => (
								<CollapsedNavItem
									key={item.href}
									item={item}
									pathname={pathname}
								/>
							))}
						</nav>
						<div className="py-3 flex justify-center w-full">
							<Tooltip delayDuration={0}>
								<TooltipTrigger asChild>
									<Avatar className="h-9 w-9">
										<AvatarFallback className="text-xs bg-primary/15 text-primary">
											{initial}
										</AvatarFallback>
									</Avatar>
								</TooltipTrigger>
								<TooltipContent side="right" sideOffset={8}>
									{userLabel}
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
				) : (
					<div className="flex h-screen w-[260px] flex-col">
						<div className="px-3 h-14 flex items-center">
							<div className="flex w-full items-center justify-between px-3">
								<div className="flex items-center gap-3 min-w-0">
									<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
										S
									</span>
									<span className="text-lg font-semibold tracking-tight text-foreground truncate">
										signoff
									</span>
									<span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground leading-none shrink-0">
										v{__APP_VERSION__}
									</span>
								</div>
								<button
									type="button"
									onClick={() => {
										toggle();
										localStorage.setItem("signoff-sidebar-collapsed", "1");
									}}
									aria-label="Collapse sidebar"
									className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors shrink-0"
								>
									<PanelLeft
										className="h-4 w-4"
										aria-hidden
										strokeWidth={1.5}
									/>
								</button>
							</div>
						</div>

						<nav className="flex-1 overflow-y-auto pt-1">
							{GROUPS.map((group) => (
								<NavGroupSection
									key={group.label}
									group={group}
									pathname={pathname}
								/>
							))}
						</nav>

						<div className="px-4 py-3">
							<div className="flex items-center gap-3">
								<Avatar className="h-9 w-9 shrink-0">
									<AvatarFallback className="text-xs bg-primary/15 text-primary">
										{initial}
									</AvatarFallback>
								</Avatar>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium text-foreground truncate">
										{userLabel}
									</p>
									{userEmail ? (
										<p className="text-xs text-muted-foreground truncate">
											{userEmail}
										</p>
									) : (
										<p className="text-xs text-muted-foreground truncate">
											local session
										</p>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</aside>
		</TooltipProvider>
	);
}
