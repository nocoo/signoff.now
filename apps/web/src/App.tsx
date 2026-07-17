import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { ActivityPlaceholder } from "@/views/activity/ActivityPlaceholder";
import { DashboardPage } from "@/views/DashboardPage";
import { DevelopersPage } from "@/views/developers/DevelopersPage";
import { ReposPage } from "@/views/repos/ReposPage";
import { SettingsPage } from "@/views/settings/SettingsPage";
import { TagsPage } from "@/views/tags/TagsPage";
import { TeamsPage } from "@/views/teams/TeamsPage";

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route element={<AppShell />}>
					<Route path="/" element={<DashboardPage />} />
					<Route path="/settings" element={<SettingsPage />} />
					<Route path="/developers" element={<DevelopersPage />} />
					<Route path="/teams" element={<TeamsPage />} />
					<Route path="/tags" element={<TagsPage />} />
					<Route path="/repos" element={<ReposPage />} />
					<Route path="/activity" element={<ActivityPlaceholder />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Route>
			</Routes>
		</BrowserRouter>
	);
}
