import { useId } from "react";
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
import {
	type TeamDraft,
	useTeamEditViewModel,
} from "@/viewmodels/useTeamsViewModel";

export type { TeamDraft };

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
	const vm = useTeamEditViewModel(team, onSubmit, () => onOpenChange(false));

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// Not closable mid-save; see DeveloperDialog for why.
				if (!vm.busy) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit team</DialogTitle>
					<DialogDescription>
						Teams group developers for manager filters.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-3">
					<EntityAvatar
						name={vm.draft.name}
						avatarUrl={vm.draft.avatarUrl}
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
							value={vm.draft.name}
							onChange={(e) => vm.setField("name", e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={avatarId}>Avatar URL</Label>
						<Input
							id={avatarId}
							value={vm.draft.avatarUrl}
							placeholder="https://…"
							onChange={(e) => vm.setField("avatarUrl", e.target.value)}
						/>
					</div>
				</div>

				{vm.error ? (
					<p role="alert" className="text-sm text-destructive">
						{vm.error}
					</p>
				) : null}

				<DialogFooter>
					<Button
						variant="outline"
						disabled={vm.busy}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button disabled={vm.busy} onClick={() => void vm.save()}>
						{vm.busy ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
