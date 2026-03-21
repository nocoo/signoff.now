/**
 * Dashboard index page — rendered at "/" under the dashboard layout.
 *
 * Shows a welcome/empty state when no workspace is active.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/")({
	component: DashboardPage,
});

function DashboardPage() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="text-center">
				<h1 className="text-2xl font-semibold tracking-tight">Signoff</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Select a workspace to get started
				</p>
			</div>
		</div>
	);
}
