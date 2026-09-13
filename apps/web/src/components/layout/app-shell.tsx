import {
	Button,
	ContentIsland,
	Sheet,
	SheetContent,
	SheetTitle,
	ThemeToggle,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import {
	AppMain,
	AppSkipLink,
	AppShell as BasaltAppShell,
} from "@nocoo/basalt/components/app-shell";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Github } from "@/components/icons/github";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { fetchMe } from "@/models/entitiesApi";
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
	const isMobile = useIsMobile();
	const location = useLocation();
	const [collapsed, setCollapsed] = useState(storedSidebarState);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [userLabel, setUserLabel] = useState("Loading…");
	const [userEmail, setUserEmail] = useState<string | undefined>();

	useEffect(() => {
		void fetchMe()
			.then((me) => {
				if (me.authenticated && me.email) {
					setUserLabel(me.email.split("@")[0] || me.email);
					setUserEmail(me.email);
				} else {
					setUserLabel("Dev");
					setUserEmail("anonymous@local");
				}
			})
			.catch(() => {
				setUserLabel("Offline");
				setUserEmail(undefined);
			});
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: navigation closes the mobile drawer
	useEffect(() => setMobileOpen(false), [location.pathname]);

	const setDesktopCollapsed = (next: boolean) => {
		setCollapsed(next);
		persistSidebarState(next);
	};
	const trail = breadcrumbsFromPathname(location.pathname);
	const current = trail[trail.length - 1]?.label ?? "Dashboard";
	const ancestors = trail.slice(0, -1);

	return (
		<BasaltAppShell>
			<AppSkipLink>Skip to main content</AppSkipLink>
			{!isMobile ? (
				<Sidebar
					collapsed={collapsed}
					userLabel={userLabel}
					userEmail={userEmail}
					onToggle={() => setDesktopCollapsed(!collapsed)}
				/>
			) : (
				<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
					<SheetContent
						side="left"
						className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0"
					>
						<SheetTitle className="sr-only">Navigation</SheetTitle>
						<Sidebar
							collapsed={false}
							userLabel={userLabel}
							userEmail={userEmail}
							onToggle={() => setMobileOpen(false)}
							onNavigate={() => setMobileOpen(false)}
						/>
					</SheetContent>
				</Sheet>
			)}
			<AppMain>
				<AppHeader
					leading={
						isMobile ? (
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								onClick={() => setMobileOpen(true)}
								aria-label="Open navigation"
							>
								<Menu className="h-5 w-5" aria-hidden strokeWidth={1.5} />
							</Button>
						) : null
					}
					breadcrumbs={ancestors}
					title={current}
					actions={
						<>
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
							<ThemeToggle aria-label="Change theme" />
						</>
					}
				/>
				<div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
					<ContentIsland>
						<Outlet />
					</ContentIsland>
				</div>
			</AppMain>
		</BasaltAppShell>
	);
}
