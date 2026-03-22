/**
 * Dashboard index page — rendered at "/" under the dashboard layout.
 *
 * Renders the mosaic-based pane layout in the main content area.
 * When no panes exist, the MosaicLayout shows an empty state.
 */

import { createFileRoute } from "@tanstack/react-router";
import { MosaicLayout } from "../../components/MosaicLayout";

export const Route = createFileRoute("/_dashboard/")({
	component: DashboardPage,
});

function DashboardPage() {
	return <MosaicLayout />;
}
