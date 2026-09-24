import {
	Button,
	ContentIsland,
	SegmentControl,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { Breadcrumbs } from "@nocoo/basalt/components/breadcrumbs";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Github } from "@/components/icons/github";
import { SelectControl } from "@/components/SelectControl";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { displayName } from "@/models/sessionApi";
import type { PullFilter } from "@/models/workbench";
import { useSession } from "@/viewmodels/SessionProvider";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { HeaderTooltip, HexlyLink } from "./header-links";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

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
	const userLabel = session ? displayName(session) : "Offline";
	const userEmail = session?.email ?? session?.principal ?? undefined;
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: navigation closes the mobile drawer
	useEffect(() => setMobileOpen(false), [location.pathname]);

	const setDesktopCollapsed = (next: boolean) => {
		setCollapsed(next);
		persistSidebarState(next);
	};
	const trail = breadcrumbsFromPathname(location.pathname);

	return (
		<BasaltAppShell className="relative">
			<AppSkipLink>Skip to main content</AppSkipLink>
			{!isMobile ? (
				<Sidebar
					collapsed={collapsed}
					userLabel={userLabel}
					userEmail={userEmail}
					admin={admin}
					tenantSwitcher={tenantSwitcher}
					onToggle={() => setDesktopCollapsed(!collapsed)}
				/>
			) : (
				<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
					<SheetContent
						side="left"
						className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							menuRef.current?.focus();
						}}
					>
						<SheetTitle className="sr-only">Navigation</SheetTitle>
						<SheetDescription className="sr-only">
							Choose a page in signoff.now.
						</SheetDescription>
						<Sidebar
							collapsed={false}
							userLabel={userLabel}
							userEmail={userEmail}
							admin={admin}
							tenantSwitcher={tenantSwitcher}
							onToggle={() => setMobileOpen(false)}
							onNavigate={() => setMobileOpen(false)}
						/>
					</SheetContent>
				</Sheet>
			)}
			<AppMain tabIndex={-1}>
				<AppHeader
					leading={
						<>
							{isMobile ? (
								<HeaderTooltip label="Open navigation">
									<Button
										ref={menuRef}
										variant="ghost"
										size="icon"
										className="h-8 w-8"
										onClick={() => setMobileOpen(true)}
										aria-label="Open navigation"
									>
										<Menu className="h-5 w-5" aria-hidden strokeWidth={1.5} />
									</Button>
								</HeaderTooltip>
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
								<HeaderTooltip label="GitHub repository">
									<Button variant="ghost" size="icon" asChild>
										<a
											href="https://github.com/nocoo/signoff.now"
											target="_blank"
											rel="noopener noreferrer"
											aria-label="GitHub repository"
										>
											<Github
												className="h-[18px] w-[18px]"
												aria-hidden
												strokeWidth={1.5}
											/>
										</a>
									</Button>
								</HeaderTooltip>
								<HexlyLink />
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
