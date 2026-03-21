/**
 * Behavior settings page.
 *
 * Controls: confirm on quit, file open mode, link handling, default editor.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/behavior")({
	component: BehaviorSettings,
});

function BehaviorSettings() {
	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Behavior</h3>
			<p className="text-sm text-neutral-500">
				Configure app behavior, file handling, and integrations.
			</p>
		</div>
	);
}
