import { useEffect, useId, useState } from "react";
import { EntityAvatar } from "@/components/EntityAvatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Team } from "@/models/entities";
import { validateAvatarUrl } from "@/models/entities";

export type TeamDraft = { name: string; avatarUrl: string };

export type TeamDialogProps = {
	team: Team | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: TeamDraft) => Promise<void>;
};

export function TeamDialog({
	team,
	open,
	onOpenChange,
	onSubmit,
}: TeamDialogProps) {
	const nameId = useId();
	const avatarId = useId();
	const [draft, setDraft] = useState<TeamDraft>({ name: "", avatarUrl: "" });
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open && team) {
			setDraft({ name: team.name, avatarUrl: team.avatarUrl ?? "" });
			setError(null);
		}
	}, [open, team]);

	const save = async () => {
		if (!draft.name.trim()) {
			setError("Name is required");
			return;
		}
		const invalid = validateAvatarUrl(draft.avatarUrl);
		if (invalid) {
			setError(invalid);
			return;
		}
		setBusy(true);
		try {
			await onSubmit(draft);
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Save failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit team</DialogTitle>
					<DialogDescription>
						Teams group developers for manager filters.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-3">
					<EntityAvatar
						name={draft.name}
						avatarUrl={draft.avatarUrl}
						size="lg"
					/>
					<p className="text-xs text-muted-foreground">
						Falls back to an initial on a colour derived from the name.
					</p>
				</div>

				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor={nameId}>Name</Label>
						<Input
							id={nameId}
							value={draft.name}
							onChange={(e) =>
								setDraft((d) => ({ ...d, name: e.target.value }))
							}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={avatarId}>Avatar URL</Label>
						<Input
							id={avatarId}
							value={draft.avatarUrl}
							placeholder="https://…"
							onChange={(e) =>
								setDraft((d) => ({ ...d, avatarUrl: e.target.value }))
							}
						/>
					</div>
				</div>

				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={busy} onClick={() => void save()}>
						{busy ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
