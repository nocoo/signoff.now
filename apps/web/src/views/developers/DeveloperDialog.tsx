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
import type { Developer, Team } from "@/models/entities";
import { useDeveloperEditViewModel } from "@/viewmodels/useDeveloperEditViewModel";
import type { DeveloperDraft } from "@/viewmodels/useDevelopersViewModel";

export type { DeveloperDraft };

export type DeveloperDialogProps = {
	developer: Developer | null;
	teams: Team[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: DeveloperDraft) => Promise<void>;
};

/** Edit one developer: identity, avatar and team membership in one place. */
export function DeveloperDialog({
	developer,
	teams,
	open,
	onOpenChange,
	onSubmit,
}: DeveloperDialogProps) {
	const nameId = useId();
	const aliasId = useId();
	const avatarId = useId();
	const vm = useDeveloperEditViewModel(developer, onSubmit, () =>
		onOpenChange(false),
	);

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
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit developer</DialogTitle>
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
							onChange={(e) => vm.setField("name", e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={aliasId}>Alias</Label>
						<Input
							id={aliasId}
							value={vm.draft.alias}
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
