import { Menu, PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchMe } from "@/models/entitiesApi";

const TITLES: Record<string, string> = {
	"/": "Dashboard",
	"/settings": "Settings",
	"/developers": "Developers",
	"/teams": "Teams",
	"/tags": "Tags",
	"/repos": "Repos",
	"/activity": "Activity",
};

export function DashboardLayout() {
	const [collapsed, setCollapsed] = useState(false);
	const isMobile = useIsMobile();
	const [mobileOpen, setMobileOpen] = useState(false);
	const location = useLocation();
	const [userLabel, setUserLabel] = useState("Loading…");

	useEffect(() => {
		void fetchMe()
			.then((me) => {
				if (me.authenticated && me.email) {
					setUserLabel(me.email);
				} else {
					setUserLabel("Dev (anonymous)");
				}
			})
			.catch(() => setUserLabel("Offline"));
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: close drawer on navigate
	useEffect(() => {
		setMobileOpen(false);
	}, [location.pathname]);

	const title = TITLES[location.pathname] ?? "signoff.now";

	return (
		<div className="flex min-h-screen w-full bg-background">
			{isMobile ? null : (
				<AppSidebar collapsed={collapsed} userLabel={userLabel} />
			)}
			{isMobile && mobileOpen ? (
				<div className="fixed inset-0 z-40 flex">
					<button
						type="button"
						className="absolute inset-0 bg-black/40"
						aria-label="Close menu"
						onClick={() => setMobileOpen(false)}
					/>
					<div className="relative z-50">
						<AppSidebar collapsed={false} userLabel={userLabel} />
					</div>
				</div>
			) : null}
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-14 items-center gap-2 border-b border-border bg-card px-4">
					{isMobile ? (
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setMobileOpen(true)}
						>
							<Menu className="h-4 w-4" />
						</Button>
					) : (
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setCollapsed((c) => !c)}
						>
							<PanelLeft className="h-4 w-4" />
						</Button>
					)}
					<h1 className="font-display flex-1 text-sm font-semibold">{title}</h1>
					<ThemeToggle />
				</header>
				<main id="main-content" className="flex-1 overflow-auto p-4 md:p-6">
					<div className="mx-auto max-w-5xl rounded-[var(--radius-card)] bg-card p-4 shadow-sm md:p-6">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	);
}
