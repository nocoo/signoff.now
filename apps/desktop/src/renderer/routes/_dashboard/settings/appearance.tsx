/**
 * Appearance settings page.
 *
 * Controls: terminal font, editor font, theme preferences.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/appearance")({
	component: AppearanceSettings,
});

function AppearanceSettings() {
	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Appearance</h3>
			<p className="text-sm text-neutral-500">
				Customize fonts, colors, and visual preferences.
			</p>
		</div>
	);
}
