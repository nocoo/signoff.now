import { EntityAvatar } from "@/components/EntityAvatar";
import { Field } from "@/components/Field";
import { TagPicker } from "@/components/TagPicker";
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
import type { Tag, Team } from "@/models/entities";
import {
	type TeamDraft,
	useTeamEditViewModel,
} from "@/viewmodels/useTeamsViewModel";

export type { TeamDraft };

export type TeamDialogProps = {
	team: Team | null;
	tags: Tag[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: TeamDraft) => Promise<void>;
	onCreateTag: (name: string) => Promise<string>;
};

export function TeamDialog({
	team,
	tags,
	open,
	onOpenChange,
	onSubmit,
	onCreateTag,
}: TeamDialogProps) {
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
			<DialogContent className="max-h-[85vh] overflow-y-auto">
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

				<div className="flex flex-col gap-4">
					<Field label="Name">
						{(id) => (
							<Input
								id={id}
								value={vm.draft.name}
								onChange={(e) => vm.setField("name", e.target.value)}
							/>
						)}
					</Field>
					<Field label="Avatar URL">
						{(id) => (
							<Input
								id={id}
								value={vm.draft.avatarUrl}
								placeholder="https://…"
								onChange={(e) => vm.setField("avatarUrl", e.target.value)}
							/>
						)}
					</Field>

					<fieldset className="flex flex-col gap-(--control-gap)">
						<legend className="text-sm font-medium">Tags</legend>
						<TagPicker
							tags={tags}
							selected={vm.draft.tagIds}
							onToggle={vm.toggleTag}
							disabled={vm.busy}
							onCreate={async (name) => {
								vm.selectTag(await onCreateTag(name));
							}}
						/>
					</fieldset>
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
