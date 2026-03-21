/**
 * Terminal settings page.
 *
 * Controls: link behavior, persistence, font, presets bar.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/terminal")({
	component: TerminalSettings,
});

function TerminalSettings() {
	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Terminal</h3>
			<p className="text-sm text-neutral-500">
				Configure terminal behavior, fonts, and link handling.
			</p>
		</div>
	);
}
