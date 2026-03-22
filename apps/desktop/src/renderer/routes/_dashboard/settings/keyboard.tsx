/**
 * Keyboard settings page.
 *
 * Lists all keyboard shortcuts from hotkeys.list, allows editing.
 * Reads from tRPC hotkeys.list, writes via hotkeys.update.
 */

import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_dashboard/settings/keyboard")({
	component: KeyboardSettings,
});

function KeyboardSettings() {
	const { data: hotkeys, isLoading } = trpc.hotkeys.list.useQuery();
	const utils = trpc.useUtils();
	const updateMutation = trpc.hotkeys.update.useMutation({
		onSuccess: () => {
			utils.hotkeys.list.invalidate();
		},
	});
	const resetAllMutation = trpc.hotkeys.resetAll.useMutation({
		onSuccess: () => {
			utils.hotkeys.list.invalidate();
		},
	});

	const [editingAction, setEditingAction] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");

	const handleEdit = useCallback((action: string, currentKeys: string) => {
		setEditingAction(action);
		setEditValue(currentKeys);
	}, []);

	const handleSave = useCallback(
		(action: string) => {
			if (editValue.trim()) {
				updateMutation.mutate({ action, keys: editValue.trim() });
			}
			setEditingAction(null);
		},
		[editValue, updateMutation],
	);

	const handleCancel = useCallback(() => {
		setEditingAction(null);
	}, []);

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">Loading hotkeys…</div>
		);
	}

	// Group hotkeys by category
	type HotkeyBinding = {
		action: string;
		keys: string;
		label: string;
		category: string;
	};
	const grouped = (hotkeys ?? []).reduce<Record<string, HotkeyBinding[]>>(
		(acc, hotkey) => {
			const cat = hotkey.category || "general";
			if (!acc[cat]) acc[cat] = [];
			acc[cat].push(hotkey);
			return acc;
		},
		{},
	);

	return (
		<div>
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h3 className="text-lg font-semibold">Keyboard</h3>
					<p className="text-sm text-muted-foreground">
						Customize keyboard shortcuts and keybindings.
					</p>
				</div>
				<button
					type="button"
					className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
					onClick={() => resetAllMutation.mutate()}
				>
					Reset All
				</button>
			</div>

			<div className="space-y-6">
				{Object.entries(grouped).map(([category, bindings]) => (
					<div key={category}>
						<Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
							{category}
						</Label>
						<div className="space-y-1">
							{bindings.map((binding) => (
								<div
									key={binding.action}
									className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted/50"
								>
									<span className="text-sm">{binding.label}</span>
									{editingAction === binding.action ? (
										<div className="flex items-center gap-1">
											<Input
												className="h-7 w-40 text-xs"
												value={editValue}
												onChange={(e) => setEditValue(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") handleSave(binding.action);
													if (e.key === "Escape") handleCancel();
												}}
												autoFocus
											/>
											<button
												type="button"
												className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
												onClick={() => handleSave(binding.action)}
											>
												Save
											</button>
										</div>
									) : (
										<button
											type="button"
											className="rounded bg-muted px-2 py-0.5 font-mono text-xs"
											onClick={() => handleEdit(binding.action, binding.keys)}
										>
											{binding.keys}
										</button>
									)}
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
