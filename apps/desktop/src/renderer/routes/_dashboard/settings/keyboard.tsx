/**
 * Keyboard settings page.
 *
 * Controls: keyboard shortcuts, keybindings.
 * Populated in Commit #19 (keyboard shortcuts system).
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/keyboard")({
	component: KeyboardSettings,
});

function KeyboardSettings() {
	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Keyboard</h3>
			<p className="text-sm text-neutral-500">
				Customize keyboard shortcuts and keybindings.
			</p>
		</div>
	);
}
