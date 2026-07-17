import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Github } from "@/components/icons/github";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { fetchMe } from "@/models/entitiesApi";
import { Breadcrumbs } from "./breadcrumbs";
import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { ThemeToggle } from "./theme-toggle";

function AppShellInner() {
	const isMobile = useIsMobile();
	const { mobileOpen, setMobileOpen } = useSidebar();
	const location = useLocation();
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: close drawer on navigate
	useEffect(() => {
		setMobileOpen(false);
	}, [location.pathname, setMobileOpen]);

	useEffect(() => {
		if (mobileOpen) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [mobileOpen]);

	const breadcrumbs = breadcrumbsFromPathname(location.pathname);

	return (
		<div className="flex min-h-screen w-full bg-background">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
			>
				Skip to main content
			</a>

			{!isMobile && <Sidebar userLabel={userLabel} userEmail={userEmail} />}

			{isMobile && mobileOpen ? (
				<>
					{/* biome-ignore lint/a11y/useSemanticElements: backdrop overlay */}
					<div
						role="button"
						tabIndex={0}
						aria-label="Close sidebar"
						className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
						onClick={() => setMobileOpen(false)}
						onKeyDown={(e) => {
							if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setMobileOpen(false);
							}
						}}
					/>
					<div className="fixed inset-y-0 left-0 z-50 w-[260px]">
						<Sidebar userLabel={userLabel} userEmail={userEmail} />
					</div>
				</>
			) : null}

			<main
				id="main-content"
				className="flex flex-1 flex-col min-h-screen min-w-0"
			>
				<header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
					<div className="flex items-center gap-3 min-w-0">
						{isMobile ? (
							<button
								type="button"
								onClick={() => setMobileOpen(true)}
								aria-label="Open navigation"
								className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
							>
								<Menu className="h-5 w-5" aria-hidden strokeWidth={1.5} />
							</button>
						) : null}
						<Breadcrumbs items={breadcrumbs} />
					</div>
					<div className="flex items-center gap-1">
						<a
							href="https://github.com/nocoo/signoff.now"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="GitHub repository"
							className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
						>
							<Github
								className="h-[18px] w-[18px]"
								aria-hidden
								strokeWidth={1.5}
							/>
						</a>
						<ThemeToggle />
					</div>
				</header>

				{/* Floating island (Basalt AppShell) */}
				<div className="flex-1 px-2 pb-2 md:px-3 md:pb-3 min-h-0">
					<div className="h-full rounded-[16px] md:rounded-[var(--radius-island)] bg-card p-3 md:p-5 overflow-y-auto">
						<Outlet />
					</div>
				</div>
			</main>
		</div>
	);
}

export function AppShell() {
	return (
		<SidebarProvider>
			<AppShellInner />
		</SidebarProvider>
	);
}
