/**
 * Git settings page.
 *
 * Controls: branch prefix, worktree base dir, delete local branch.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/git")({
	component: GitSettings,
});

function GitSettings() {
	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Git</h3>
			<p className="text-sm text-neutral-500">
				Configure branch naming, worktree locations, and git behavior.
			</p>
		</div>
	);
}
