import { Field } from "@/components/Field";
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
import type { Tag } from "@/models/entities";
import {
	type TagDraft,
	useTagEditViewModel,
} from "@/viewmodels/useTagsViewModel";

export type { TagDraft };

export type TagDialogProps = {
	/** `null` means this is a create, not an edit. */
	tag: Tag | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: TagDraft) => Promise<void>;
};

/** Create or edit one tag: name and colour. */
export function TagDialog({
	tag,
	open,
	onOpenChange,
	onSubmit,
}: TagDialogProps) {
	const vm = useTagEditViewModel(tag, onSubmit, () => onOpenChange(false));
	const creating = tag === null;

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
					<DialogTitle>{creating ? "Add tag" : "Edit tag"}</DialogTitle>
					<DialogDescription>
						Colour labels for developers and teams (filtering and comparison).
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-3">
					<span
						className="inline-block h-10 w-10 rounded-full ring-1 ring-border"
						style={{ background: vm.draft.color }}
					/>
					<p className="text-xs text-muted-foreground">
						How this tag reads on a roster row.
					</p>
				</div>

				<div className="flex flex-col gap-4">
					<Field label="Name">
						{(id) => (
							<Input
								id={id}
								value={vm.draft.name}
								placeholder="frontend"
								onChange={(e) => vm.setField("name", e.target.value)}
							/>
						)}
					</Field>
					<Field label="Colour" hint="Stored as a #RRGGBB hex value.">
						{(id) => (
							<Input
								id={id}
								type="color"
								className="w-20 p-1"
								value={vm.draft.color}
								onChange={(e) => vm.setField("color", e.target.value)}
							/>
						)}
					</Field>
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
