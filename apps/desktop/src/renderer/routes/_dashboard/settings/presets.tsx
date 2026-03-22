/**
 * Presets settings page.
 *
 * Controls: autoApplyDefaultPreset toggle.
 * Terminal presets JSON management is deferred to a later phase.
 * Reads from tRPC settings.get, writes via settings.update.
 */

import { Label } from "@signoff/ui/label";
import { Switch } from "@signoff/ui/switch";
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_dashboard/settings/presets")({
	component: PresetsSettings,
});

function PresetsSettings() {
	const { data: settings, isLoading } = trpc.settings.get.useQuery();
	const utils = trpc.useUtils();
	const updateMutation = trpc.settings.update.useMutation({
		onSuccess: () => {
			utils.settings.get.invalidate();
		},
	});

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">Loading settings…</div>
		);
	}

	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Presets</h3>
			<p className="mb-6 text-sm text-muted-foreground">
				Manage terminal presets for quick workspace setup.
			</p>

			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<Label htmlFor="autoApplyDefaultPreset">
							Auto-apply Default Preset
						</Label>
						<p className="text-xs text-muted-foreground">
							Automatically apply the default preset when opening a new
							terminal.
						</p>
					</div>
					<Switch
						id="autoApplyDefaultPreset"
						checked={settings?.autoApplyDefaultPreset ?? false}
						onCheckedChange={(checked) => {
							updateMutation.mutate({ autoApplyDefaultPreset: checked });
						}}
					/>
				</div>

				<div className="rounded-md border border-border p-4">
					<p className="text-sm text-muted-foreground">
						Terminal preset management (create, edit, delete presets) will be
						available in a future update.
					</p>
				</div>
			</div>
		</div>
	);
}
