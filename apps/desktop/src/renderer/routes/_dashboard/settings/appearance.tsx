/**
 * Appearance settings page.
 *
 * Controls: editor font family, editor font size.
 * Reads from tRPC settings.get, writes via settings.update.
 */

import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_dashboard/settings/appearance")({
	component: AppearanceSettings,
});

function AppearanceSettings() {
	const { data: settings, isLoading } = trpc.settings.get.useQuery();
	const utils = trpc.useUtils();
	const updateMutation = trpc.settings.update.useMutation({
		onSuccess: () => {
			utils.settings.get.invalidate();
		},
	});

	const [editorFontFamily, setEditorFontFamily] = useState("");
	const [editorFontSize, setEditorFontSize] = useState(14);

	useEffect(() => {
		if (settings) {
			setEditorFontFamily(settings.editorFontFamily ?? "");
			setEditorFontSize(settings.editorFontSize ?? 14);
		}
	}, [settings]);

	const handleFontFamilyBlur = useCallback(() => {
		updateMutation.mutate({ editorFontFamily: editorFontFamily || null });
	}, [editorFontFamily, updateMutation]);

	const handleFontSizeBlur = useCallback(() => {
		const size = Number(editorFontSize);
		if (size > 0) {
			updateMutation.mutate({ editorFontSize: size });
		}
	}, [editorFontSize, updateMutation]);

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">Loading settings…</div>
		);
	}

	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Appearance</h3>
			<p className="mb-6 text-sm text-muted-foreground">
				Customize fonts, colors, and visual preferences.
			</p>

			<div className="space-y-6">
				<div className="space-y-2">
					<Label htmlFor="editorFontFamily">Editor Font Family</Label>
					<Input
						id="editorFontFamily"
						value={editorFontFamily}
						onChange={(e) => setEditorFontFamily(e.target.value)}
						onBlur={handleFontFamilyBlur}
						placeholder="Menlo, Monaco, monospace"
					/>
					<p className="text-xs text-muted-foreground">
						CSS font-family value for the code editor.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="editorFontSize">Editor Font Size</Label>
					<Input
						id="editorFontSize"
						type="number"
						min={8}
						max={32}
						value={editorFontSize}
						onChange={(e) => setEditorFontSize(Number(e.target.value))}
						onBlur={handleFontSizeBlur}
					/>
					<p className="text-xs text-muted-foreground">
						Font size in pixels for the code editor.
					</p>
				</div>
			</div>
		</div>
	);
}
