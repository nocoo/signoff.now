import {
	LinkProvider,
	ThemeProvider,
	Toaster,
	TooltipProvider,
} from "@nocoo/basalt";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import { type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/viewmodels/SessionProvider";
import { WorkbenchProvider } from "@/viewmodels/WorkbenchProvider";
import { AdminPage } from "@/views/admin/AdminPage";
import { CollectionsPage } from "@/views/collections/CollectionsPage";
import {
	DirectoryTagsPage,
	DirectoryTeamsPage,
	MembersPage,
} from "@/views/directory/DirectoryPage";
import { InsightsPage } from "@/views/insights/InsightsPage";
import { SessionGate } from "@/views/session/SessionGate";
import { AiSettingsPage } from "@/views/settings/AiSettingsPage";
import { SettingsPage } from "@/views/settings/SettingsPage";
import { ProjectsPage } from "@/views/workbench/ProjectsPage";
import { PullsPage } from "@/views/workbench/PullsPage";
import { RepositoriesPage } from "@/views/workbench/RepositoriesPage";

const PolicyInstructionsPage = lazy(
	() => import("@/views/settings/PolicyInstructionsPage"),
);

const StateMachinesPage = lazy(
	() => import("@/views/state-machines/StateMachinesPage"),
);

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
				{/* URL-controlled filters update within the input event. */}
				<BrowserRouter useTransitions={false}>
					<LinkProvider render={RouterLink}>
						<TooltipProvider>
							<Toaster />
							<Routes>
								<Route
									element={
										<SessionProvider>
											<SessionGate>
												<WorkbenchProvider>
													<AppShell />
												</WorkbenchProvider>
											</SessionGate>
										</SessionProvider>
									}
								>
									<Route path="/" element={<PullsPage />} />
									<Route path="/prs/*" element={<PullsPage />} />
									<Route path="/projects" element={<ProjectsPage />} />
									<Route path="/collections" element={<CollectionsPage />} />
									<Route
										path="/collections/:id"
										element={<CollectionsPage />}
									/>
									<Route path="/insights" element={<InsightsPage />} />
									<Route path="/settings" element={<SettingsPage />} />
									<Route path="/admin" element={<AdminPage />} />
									<Route path="/ai-settings" element={<AiSettingsPage />} />
									<Route
										path="/policy-instructions/*"
										element={
											<Suspense
												fallback={
													<p role="status">Loading policy instructions…</p>
												}
											>
												<PolicyInstructionsPage />
											</Suspense>
										}
									/>
									{["/sm/*", "/state-machines"].map((path) => (
										<Route
											key={path}
											path={path}
											element={
												<Suspense
													fallback={
														<p role="status">Loading state machines…</p>
													}
												>
													<StateMachinesPage />
												</Suspense>
											}
										/>
									))}
									<Route path="/developers" element={<MembersPage />} />
									<Route path="/teams" element={<DirectoryTeamsPage />} />
									<Route path="/tags" element={<DirectoryTagsPage />} />
									<Route path="/repos" element={<RepositoriesPage />} />
									<Route
										path="/activity"
										element={<Navigate to="/insights" replace />}
									/>
									<Route path="*" element={<Navigate to="/prs" replace />} />
								</Route>
							</Routes>
						</TooltipProvider>
					</LinkProvider>
				</BrowserRouter>
			</AccentProvider>
		</ThemeProvider>
	);
}
