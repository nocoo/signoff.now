import { useId } from "react";
import { EntityAvatar } from "@/components/EntityAvatar";
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
import { Label } from "@/components/ui/label";
import type { Developer, Tag, Team } from "@/models/entities";
import { useDeveloperEditViewModel } from "@/viewmodels/useDeveloperEditViewModel";
import type { DeveloperDraft } from "@/viewmodels/useDevelopersViewModel";

export type { DeveloperDraft };

export type DeveloperDialogProps = {
	/** `null` means this is a create, not an edit. */
	developer: Developer | null;
	teams: Team[];
	tags: Tag[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: DeveloperDraft) => Promise<void>;
	onCreateTag: (name: string) => Promise<string>;
};

/**
 * Create or edit one developer: identity, avatar, teams and tags.
 *
 * One component for both, because the fields are identical — a separate "add"
 * form would drift, and the old inline one already had, offering neither an
 * avatar nor a team.
 */
export function DeveloperDialog({
	developer,
	teams,
	tags,
	open,
	onOpenChange,
	onSubmit,
	onCreateTag,
}: DeveloperDialogProps) {
	const nameId = useId();
	const aliasId = useId();
	const avatarId = useId();
	const vm = useDeveloperEditViewModel(developer, onSubmit, () =>
		onOpenChange(false),
	);
	const creating = developer === null;

	return (
		<Dialog
			open={open}
			// Closing is blocked while a save is in flight: letting it through
			// would resolve onto whichever entity the user opened next.
			onOpenChange={(next) => {
				if (!vm.busy) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{creating ? "Add developer" : "Edit developer"}
					</DialogTitle>
					<DialogDescription>
						The alias drives identity matching; changing it re-runs scoring.
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
							placeholder="Display name"
							onChange={(e) => vm.setField("name", e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={aliasId}>Alias</Label>
						<Input
							id={aliasId}
							value={vm.draft.alias}
							placeholder="ada"
							onChange={(e) => vm.setField("alias", e.target.value)}
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

					{teams.length > 0 ? (
						<fieldset className="space-y-1.5">
							<legend className="text-sm font-medium">Teams</legend>
							<div className="flex flex-wrap gap-2">
								{teams.map((t) => {
									const on = vm.draft.teamIds.includes(t.id);
									return (
										<button
											type="button"
											key={t.id}
											aria-pressed={on}
											onClick={() => vm.toggleTeam(t.id)}
											className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
												on
													? "border-primary bg-primary/10 text-foreground"
													: "border-border text-muted-foreground hover:bg-secondary"
											}`}
										>
											<EntityAvatar
												name={t.name}
												avatarUrl={t.avatarUrl}
												size="sm"
											/>
											{t.name}
										</button>
									);
								})}
							</div>
						</fieldset>
					) : null}

					<fieldset className="space-y-1.5">
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
						{vm.busy ? "Saving…" : creating ? "Create" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
