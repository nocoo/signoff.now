/**
 * Presets settings page.
 *
 * Controls: terminal presets management.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/presets")({
	component: PresetsSettings,
});

function PresetsSettings() {
	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Presets</h3>
			<p className="text-sm text-neutral-500">
				Manage terminal presets for quick workspace setup.
			</p>
		</div>
	);
}
