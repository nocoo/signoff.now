/**
 * Git settings page.
 *
 * Controls: branchPrefixMode, branchPrefixCustom, deleteLocalBranch, worktreeBaseDir.
 * Reads from tRPC settings.get, writes via settings.update.
 */

import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import { Switch } from "@signoff/ui/switch";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_dashboard/settings/git")({
	component: GitSettings,
});

function GitSettings() {
	const { data: settings, isLoading } = trpc.settings.get.useQuery();
	const utils = trpc.useUtils();
	const updateMutation = trpc.settings.update.useMutation({
		onSuccess: () => {
			utils.settings.get.invalidate();
		},
	});

	const [branchPrefixCustom, setBranchPrefixCustom] = useState("");
	const [worktreeBaseDir, setWorktreeBaseDir] = useState("");

	useEffect(() => {
		if (settings) {
			setBranchPrefixCustom(settings.branchPrefixCustom ?? "");
			setWorktreeBaseDir(settings.worktreeBaseDir ?? "");
		}
	}, [settings]);

	const handlePrefixBlur = useCallback(() => {
		updateMutation.mutate({
			branchPrefixCustom: branchPrefixCustom || null,
		});
	}, [branchPrefixCustom, updateMutation]);

	const handleWorktreeBlur = useCallback(() => {
		updateMutation.mutate({ worktreeBaseDir: worktreeBaseDir || null });
	}, [worktreeBaseDir, updateMutation]);

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">Loading settings…</div>
		);
	}

	return (
		<div>
			<h3 className="mb-4 text-lg font-semibold">Git</h3>
			<p className="mb-6 text-sm text-muted-foreground">
				Configure branch naming, worktree locations, and git behavior.
			</p>

			<div className="space-y-6">
				<div className="space-y-2">
					<Label>Branch Prefix Mode</Label>
					<div className="flex gap-2">
						{["none", "username", "custom"].map((mode) => (
							<button
								key={mode}
								type="button"
								className={`rounded-md border px-3 py-1.5 text-sm ${
									settings?.branchPrefixMode === mode
										? "border-primary bg-primary/10 text-primary"
										: "border-border text-muted-foreground hover:text-foreground"
								}`}
								onClick={() =>
									updateMutation.mutate({ branchPrefixMode: mode })
								}
							>
								{mode}
							</button>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						Prefix added to new branch names.
					</p>
				</div>

				{settings?.branchPrefixMode === "custom" && (
					<div className="space-y-2">
						<Label htmlFor="branchPrefixCustom">Custom Branch Prefix</Label>
						<Input
							id="branchPrefixCustom"
							value={branchPrefixCustom}
							onChange={(e) => setBranchPrefixCustom(e.target.value)}
							onBlur={handlePrefixBlur}
							placeholder="feature/"
						/>
					</div>
				)}

				<div className="flex items-center justify-between">
					<div>
						<Label htmlFor="deleteLocalBranch">
							Delete Local Branch After Merge
						</Label>
						<p className="text-xs text-muted-foreground">
							Automatically delete local branch after merging.
						</p>
					</div>
					<Switch
						id="deleteLocalBranch"
						checked={settings?.deleteLocalBranch ?? false}
						onCheckedChange={(checked) => {
							updateMutation.mutate({ deleteLocalBranch: checked });
						}}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="worktreeBaseDir">Worktree Base Directory</Label>
					<Input
						id="worktreeBaseDir"
						value={worktreeBaseDir}
						onChange={(e) => setWorktreeBaseDir(e.target.value)}
						onBlur={handleWorktreeBlur}
						placeholder="~/worktrees"
					/>
					<p className="text-xs text-muted-foreground">
						Base directory for git worktrees.
					</p>
				</div>
			</div>
		</div>
	);
}
