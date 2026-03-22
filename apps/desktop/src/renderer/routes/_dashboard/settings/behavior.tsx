/**
 * Behavior settings page.
 *
 * Controls: confirmOnQuit, fileOpenMode, openLinksInApp, defaultEditor.
 * Reads from tRPC settings.get, writes via settings.update.
 */

import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { Switch } from "@signoff/ui/switch";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_dashboard/settings/behavior")({
	component: BehaviorSettings,
});

function BehaviorSettings() {
	const { data: settings, isLoading } = trpc.settings.get.useQuery();
	const utils = trpc.useUtils();
	const updateMutation = trpc.settings.update.useMutation({
		onSuccess: () => {
			utils.settings.get.invalidate();
		},
	});

	const [defaultEditor, setDefaultEditor] = useState("");

	useEffect(() => {
		if (settings) {
			setDefaultEditor(settings.defaultEditor ?? "");
		}
	}, [settings]);

	const handleEditorBlur = useCallback(() => {
		updateMutation.mutate({ defaultEditor: defaultEditor || null });
	}, [defaultEditor, updateMutation]);

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">Loading settings…</div>
		);
	}

	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Behavior</h3>
			<p className="mb-6 text-sm text-muted-foreground">
				Configure app behavior, file handling, and integrations.
			</p>

			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<Label htmlFor="confirmOnQuit">Confirm on Quit</Label>
						<p className="text-xs text-muted-foreground">
							Ask for confirmation before closing the app.
						</p>
					</div>
					<Switch
						id="confirmOnQuit"
						checked={settings?.confirmOnQuit ?? false}
						onCheckedChange={(checked) => {
							updateMutation.mutate({ confirmOnQuit: checked });
						}}
					/>
				</div>

				<div className="flex items-center justify-between">
					<div>
						<Label htmlFor="openLinksInApp">Open Links in App</Label>
						<p className="text-xs text-muted-foreground">
							Open web links inside the app instead of the system browser.
						</p>
					</div>
					<Switch
						id="openLinksInApp"
						checked={settings?.openLinksInApp ?? false}
						onCheckedChange={(checked) => {
							updateMutation.mutate({ openLinksInApp: checked });
						}}
					/>
				</div>

				<div className="space-y-2">
					<Label>File Open Mode</Label>
					<div className="flex gap-2">
						{["split-pane", "new-tab", "replace"].map((mode) => (
							<button
								key={mode}
								type="button"
								className={`rounded-md border px-3 py-1.5 text-sm ${
									settings?.fileOpenMode === mode
										? "border-primary bg-primary/10 text-primary"
										: "border-border text-muted-foreground hover:text-foreground"
								}`}
								onClick={() => updateMutation.mutate({ fileOpenMode: mode })}
							>
								{mode}
							</button>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						How files open: split the current pane, open in a new tab, or
						replace the current content.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="defaultEditor">Default External Editor</Label>
					<Input
						id="defaultEditor"
						value={defaultEditor}
						onChange={(e) => setDefaultEditor(e.target.value)}
						onBlur={handleEditorBlur}
						placeholder="code, vim, nano…"
					/>
					<p className="text-xs text-muted-foreground">
						Command or application name for "Open in Editor" actions.
					</p>
				</div>
			</div>
		</div>
	);
}
