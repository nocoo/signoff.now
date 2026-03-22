/**
 * Dashboard index page — rendered at "/" under the dashboard layout.
 *
 * Renders the WorkspaceLayout which contains the mosaic content area
 * and the right sidebar (files/changes).
 */

import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceLayout } from "../../components/WorkspaceView/WorkspaceLayout";

export const Route = createFileRoute("/_dashboard/")({
	component: DashboardPage,
});

function DashboardPage() {
	return <WorkspaceLayout />;
}
