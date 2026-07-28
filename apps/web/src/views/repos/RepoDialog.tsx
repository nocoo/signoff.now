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
import { Select } from "@/components/ui/select";
import type { Repo } from "@/models/entities";
import {
	type RepoDraft,
	useRepoEditViewModel,
} from "@/viewmodels/useReposViewModel";

export type { RepoDraft };

export type RepoDialogProps = {
	/** `null` means this is a create, not an edit. */
	repo: Repo | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (draft: RepoDraft) => Promise<void>;
};

/**
 * Create or edit one repo binding.
 *
 * One component for both, replacing an always-open create form plus an inline
 * project-GUID cell in the table — two half-forms that between them could not
 * change an org, a provider or the enabled flag after binding.
 */
export function RepoDialog({
	repo,
	open,
	onOpenChange,
	onSubmit,
}: RepoDialogProps) {
	const vm = useRepoEditViewModel(repo, onSubmit, () => onOpenChange(false));
	const creating = repo === null;

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
					<DialogTitle>{creating ? "Bind repo" : "Edit repo"}</DialogTitle>
					<DialogDescription>
						Azure DevOps repository bindings for local pipeline collection.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Provider">
						{(id) => (
							<Select
								id={id}
								value={vm.draft.provider}
								onChange={(e) => vm.setField("provider", e.target.value)}
							>
								<option value="ado">Azure DevOps</option>
								<option value="github">GitHub</option>
							</Select>
						)}
					</Field>
					<Field label="Enabled" hint="Disabled repos are skipped on collect.">
						{(id) => (
							<Select
								id={id}
								value={vm.draft.enabled ? "yes" : "no"}
								onChange={(e) =>
									vm.setField("enabled", e.target.value === "yes")
								}
							>
								<option value="yes">Enabled</option>
								<option value="no">Disabled</option>
							</Select>
						)}
					</Field>
					<Field label="Org">
						{(id) => (
							<Input
								id={id}
								value={vm.draft.org}
								placeholder="contoso"
								onChange={(e) => vm.setField("org", e.target.value)}
							/>
						)}
					</Field>
					<Field label="Project">
						{(id) => (
							<Input
								id={id}
								value={vm.draft.project}
								placeholder="Widgets"
								onChange={(e) => vm.setField("project", e.target.value)}
							/>
						)}
					</Field>
					<Field label="Repo name" className="sm:col-span-2">
						{(id) => (
							<Input
								id={id}
								value={vm.draft.name}
								placeholder="api"
								onChange={(e) => vm.setField("name", e.target.value)}
							/>
						)}
					</Field>
					<Field label="ADO repository GUID" className="sm:col-span-2">
						{(id) => (
							<Input
								id={id}
								className="font-mono text-xs"
								value={vm.draft.externalId}
								placeholder="xxxxxxxx-xxxx-…"
								onChange={(e) => vm.setField("externalId", e.target.value)}
							/>
						)}
					</Field>
					<Field
						label="ADO project GUID (optional)"
						className="sm:col-span-2"
						hint="Used for work-item external_ref; every repo under one project must agree."
					>
						{(id) => (
							<Input
								id={id}
								className="font-mono text-xs"
								value={vm.draft.projectExternalId}
								placeholder="Project GUID"
								onChange={(e) =>
									vm.setField("projectExternalId", e.target.value)
								}
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
						{vm.busy ? "Saving…" : creating ? "Bind" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
