/**
 * Terminal settings page.
 *
 * Controls: terminal font family, font size, link behavior, persistence.
 * Reads from tRPC settings.get, writes via settings.update.
 */

import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { Switch } from "@signoff/ui/switch";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_dashboard/settings/terminal")({
	component: TerminalSettings,
});

function TerminalSettings() {
	const { data: settings, isLoading } = trpc.settings.get.useQuery();
	const utils = trpc.useUtils();
	const updateMutation = trpc.settings.update.useMutation({
		onSuccess: () => {
			utils.settings.get.invalidate();
		},
	});

	const [terminalFontFamily, setTerminalFontFamily] = useState("");
	const [terminalFontSize, setTerminalFontSize] = useState(14);

	useEffect(() => {
		if (settings) {
			setTerminalFontFamily(settings.terminalFontFamily ?? "");
			setTerminalFontSize(settings.terminalFontSize ?? 14);
		}
	}, [settings]);

	const handleFontFamilyBlur = useCallback(() => {
		updateMutation.mutate({
			terminalFontFamily: terminalFontFamily || null,
		});
	}, [terminalFontFamily, updateMutation]);

	const handleFontSizeBlur = useCallback(() => {
		const size = Number(terminalFontSize);
		if (size > 0) {
			updateMutation.mutate({ terminalFontSize: size });
		}
	}, [terminalFontSize, updateMutation]);

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">Loading settings…</div>
		);
	}

	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Terminal</h3>
			<p className="mb-6 text-sm text-muted-foreground">
				Configure terminal behavior, fonts, and link handling.
			</p>

			<div className="space-y-6">
				<div className="space-y-2">
					<Label htmlFor="terminalFontFamily">Terminal Font Family</Label>
					<Input
						id="terminalFontFamily"
						value={terminalFontFamily}
						onChange={(e) => setTerminalFontFamily(e.target.value)}
						onBlur={handleFontFamilyBlur}
						placeholder="Menlo, Monaco, monospace"
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="terminalFontSize">Terminal Font Size</Label>
					<Input
						id="terminalFontSize"
						type="number"
						min={8}
						max={32}
						value={terminalFontSize}
						onChange={(e) => setTerminalFontSize(Number(e.target.value))}
						onBlur={handleFontSizeBlur}
					/>
				</div>

				<div className="flex items-center justify-between">
					<div>
						<Label htmlFor="terminalPersistence">Terminal Persistence</Label>
						<p className="text-xs text-muted-foreground">
							Keep terminal sessions alive across tab switches.
						</p>
					</div>
					<Switch
						id="terminalPersistence"
						checked={settings?.terminalPersistence ?? true}
						onCheckedChange={(checked) => {
							updateMutation.mutate({ terminalPersistence: checked });
						}}
					/>
				</div>

				<div className="flex items-center justify-between">
					<div>
						<Label htmlFor="showPresetsBar">Show Presets Bar</Label>
						<p className="text-xs text-muted-foreground">
							Display the terminal presets toolbar.
						</p>
					</div>
					<Switch
						id="showPresetsBar"
						checked={settings?.showPresetsBar ?? true}
						onCheckedChange={(checked) => {
							updateMutation.mutate({ showPresetsBar: checked });
						}}
					/>
				</div>
			</div>
		</div>
	);
}
