import {
	LinkProvider,
	ThemeProvider,
	Toaster,
	TooltipProvider,
} from "@nocoo/basalt";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import type { ComponentType, ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { WorkbenchProvider } from "@/viewmodels/WorkbenchProvider";
import { ActivityPage } from "@/views/activity/ActivityPage";
import { DashboardPage } from "@/views/DashboardPage";
import { DevelopersPage } from "@/views/developers/DevelopersPage";
import { ReposPage } from "@/views/repos/ReposPage";
import { SettingsPage } from "@/views/settings/SettingsPage";
import { TagsPage } from "@/views/tags/TagsPage";
import { TeamsPage } from "@/views/teams/TeamsPage";
import { ProjectsPage } from "@/views/workbench/ProjectsPage";
import { PullsPage } from "@/views/workbench/PullsPage";

const BRAND_PALETTE = {
	primary: { light: "199 100% 47%", dark: "199 100% 52%" },
};

const RouterLink: ComponentType<{
	href: string;
	className?: string;
	children?: ReactNode;
}> = ({ href, className, children }) => {
	if (/^(?:https?:)?\/\//.test(href) || /^(?:mailto|tel):/.test(href)) {
		return (
			<a href={href} className={className} rel="noopener noreferrer">
				{children}
			</a>
		);
	}
	return (
		<Link to={href} className={className}>
			{children}
		</Link>
	);
};

export default function App() {
	return (
		<ThemeProvider storageKey="signoff-theme">
			<AccentProvider
				defaultAccent="primary"
				persist={false}
				paletteOverrides={BRAND_PALETTE}
			>
				<BrowserRouter>
					<LinkProvider render={RouterLink}>
						<TooltipProvider>
							<Toaster />
							<Routes>
								<Route
									element={
										<WorkbenchProvider>
											<AppShell />
										</WorkbenchProvider>
									}
								>
									<Route path="/" element={<PullsPage />} />
									<Route path="/projects" element={<ProjectsPage />} />
									<Route path="/insights" element={<DashboardPage />} />
									<Route path="/settings" element={<SettingsPage />} />
									<Route path="/developers" element={<DevelopersPage />} />
									<Route path="/teams" element={<TeamsPage />} />
									<Route path="/tags" element={<TagsPage />} />
									<Route path="/repos" element={<ReposPage />} />
									<Route path="/activity" element={<ActivityPage />} />
									<Route path="*" element={<Navigate to="/" replace />} />
								</Route>
							</Routes>
						</TooltipProvider>
					</LinkProvider>
				</BrowserRouter>
			</AccentProvider>
		</ThemeProvider>
	);
}
