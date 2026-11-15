import {
	Avatar,
	AvatarFallback,
	ContentIsland,
	SegmentControl,
	SidebarDrawer,
	SidebarProvider,
	ThemeToggle,
} from "@nocoo/basalt";
import {
	AppHeader,
	AppHeaderMenuButton,
	ProjectLinks,
} from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { Breadcrumbs } from "@nocoo/basalt/components/breadcrumbs";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { SelectControl } from "@/components/SelectControl";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import type { PullFilter } from "@/models/workbench";
import { useSession } from "@/viewmodels/SessionProvider";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { Sidebar } from "./sidebar";

const SIDEBAR_KEY = "signoff-sidebar-collapsed";

function storedSidebarState(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_KEY) === "1";
	} catch {
		return false;
	}
}

function persistSidebarState(collapsed: boolean): void {
	try {
		localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
	} catch {
		// Keep the in-memory state when storage is unavailable.
	}
}

export function AppShell() {
	const vm = useWorkbench();
	const isMobile = useIsMobile();
	const location = useLocation();
	const [collapsed, setCollapsed] = useState(storedSidebarState);
	const [mobileOpen, setMobileOpen] = useState(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	const { state, switchTenant } = useSession();
	const session = state.status === "ready" ? state.session : null;
	const admin = session?.admin ?? false;
	const tenantSwitcher =
		session && session.tenants.length > 1 ? (
			<SelectControl
				aria-label="Tenant"
				value={session.tenantId ?? ""}
				onChange={switchTenant}
				className="w-full"
			>
				{session.tenants.map((tenant) => (
					<option key={tenant.id} value={tenant.id}>
						{tenant.name}
					</option>
				))}
			</SelectControl>
		) : undefined;

	useEffect(() => setMobileOpen(false), [location.pathname]);

	const setDesktopCollapsed = (next: boolean) => {
		setCollapsed(next);
		persistSidebarState(next);
	};
	const trail = breadcrumbsFromPathname(location.pathname);
	const identityName = session?.name ?? session?.email ?? "SignOff user";
	const identityInitial = identityName.trim().slice(0, 2).toUpperCase() || "SO";
	const identityAvatar = (
		<Avatar>
			<AvatarFallback>{identityInitial}</AvatarFallback>
		</Avatar>
	);

	return (
		<BasaltAppShell className="relative">
			<AppSkipLink>Skip to main content</AppSkipLink>
			{!isMobile ? (
				<SidebarProvider
					collapsed={collapsed}
					onCollapsedChange={setDesktopCollapsed}
				>
					<Sidebar
						collapsed={collapsed}
						admin={admin}
						tenantSwitcher={tenantSwitcher}
						identityName={identityName}
						identityEmail={session?.email ?? undefined}
						identityAvatar={identityAvatar}
					/>
				</SidebarProvider>
			) : (
				<SidebarDrawer
					open={mobileOpen}
					onOpenChange={setMobileOpen}
					id="signoff-navigation"
					returnFocusRef={menuRef}
					title="Navigation"
					description="Choose a page in signoff.now."
				>
					<Sidebar
						collapsed={false}
						admin={admin}
						tenantSwitcher={tenantSwitcher}
						identityName={identityName}
						identityEmail={session?.email ?? undefined}
						identityAvatar={identityAvatar}
						onToggle={() => setMobileOpen(false)}
						onNavigate={() => setMobileOpen(false)}
						resizable={false}
					/>
				</SidebarDrawer>
			)}
			<AppMain tabIndex={-1}>
				<AppHeader
					leading={
						<>
							{isMobile ? (
								<AppHeaderMenuButton
									ref={menuRef}
									aria-controls="signoff-navigation"
									onClick={() => setMobileOpen(true)}
								/>
							) : null}
							<Breadcrumbs
								items={trail}
								className="min-w-0 [&>span]:min-w-0 [&>span>span]:truncate [&_svg]:shrink-0"
							/>
						</>
					}
					actions={
						<>
							<SegmentControl
								legend="Data source"
								className="mr-2 [&>legend]:sr-only [&_[data-slot=segment-control-viewport]]:overflow-visible [&_[data-slot=segment-control-viewport]]:pb-0"
								value={vm.filter.source}
								onValueChange={(source) =>
									vm.setFilter({ source: source as PullFilter["source"] })
								}
								options={[
									{ value: "cli", label: "Live" },
									{ value: "demo", label: "Sample" },
								]}
							/>
							<div className="hidden items-center gap-1 sm:flex">
								<ProjectLinks
									github="nocoo/signoff.now"
									hexly="signoff-now"
									name="SignOff"
								/>
							</div>
							<ThemeToggle aria-label="Change theme" />
						</>
					}
				/>
				<div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
					<ContentIsland className="relative">
						<Outlet />
					</ContentIsland>
				</div>
			</AppMain>
		</BasaltAppShell>
	);
}
