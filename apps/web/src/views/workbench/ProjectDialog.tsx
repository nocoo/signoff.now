import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import type { Project, ProjectWrite } from "@signoff/domain/workbench";
import { AlertBanner } from "@/components/AlertBanner";
import { SelectControl } from "@/components/SelectControl";
import { useProjectFormViewModel } from "@/viewmodels/useWorkbenchViewModel";

export function ProjectDialog({
	project,
	busy,
	error,
	onSave,
	onClose,
	restoreFocus,
}: {
	project: Project | null;
	busy: boolean;
	error: string | null;
	onSave: (draft: ProjectWrite) => Promise<boolean>;
	onClose: () => void;
	restoreFocus: () => void;
}) {
	const vm = useProjectFormViewModel(project, onSave);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent
				size="lg"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					restoreFocus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{project ? "Edit project" : "Add project"}</DialogTitle>
					<DialogDescription className="text-sm">
						{project?.source === "demo"
							? "Edit this sample project and its review queue."
							: "Connect an Azure DevOps project. The local collector reads PRs using your Azure CLI session."}
					</DialogDescription>
				</DialogHeader>
				<form
					className="mt-5"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (!busy)
							void vm.submit().then((success) => {
								if (success) onClose();
							});
					}}
				>
					<fieldset
						disabled={busy}
						className="grid min-w-0 gap-4 sm:grid-cols-2"
					>
						<Field label="Provider" className="sm:col-span-2">
							<SelectControl
								value="ado"
								onChange={() => vm.setField("provider", "ado")}
								disabled={busy}
							>
								<option value="ado">Azure DevOps</option>
								<option value="github" disabled>
									GitHub · coming later
								</option>
							</SelectControl>
						</Field>
						<Field
							label="Display name"
							className="sm:col-span-2"
							error={vm.errors.name}
						>
							<Input
								value={vm.draft.name}
								maxLength={100}
								placeholder="Core Platform"
								autoComplete="off"
								onChange={(event) => vm.setField("name", event.target.value)}
							/>
						</Field>
						<Field
							label="Organization"
							hint="The organization name in your ADO URL."
							error={vm.errors.organization}
						>
							<Input
								value={vm.draft.organization}
								maxLength={100}
								placeholder="northstar"
								autoComplete="off"
								onChange={(event) =>
									vm.setField("organization", event.target.value)
								}
							/>
						</Field>
						<Field
							label="ADO project"
							hint="The project name or ID in Azure DevOps."
							error={vm.errors.projectKey}
						>
							<Input
								value={vm.draft.projectKey}
								maxLength={200}
								placeholder="Platform"
								autoComplete="off"
								onChange={(event) =>
									vm.setField("projectKey", event.target.value)
								}
							/>
						</Field>
						<Field
							label="Repositories"
							className="sm:col-span-2"
							required={false}
							hint="Comma-separated repository names. Leave blank to monitor every repository in this project."
							error={vm.errors.repositories}
						>
							<Input
								value={vm.repositoryText}
								placeholder="web-app, platform-sdk"
								autoComplete="off"
								onChange={(event) => vm.setRepositoryText(event.target.value)}
							/>
						</Field>
						<Field
							label="Project owner"
							className="sm:col-span-2"
							hint="The default person responsible for the next action."
							error={vm.errors.owner}
						>
							<Input
								value={vm.draft.owner}
								maxLength={100}
								placeholder="Maya Chen"
								autoComplete="off"
								onChange={(event) => vm.setField("owner", event.target.value)}
							/>
						</Field>
						<Field
							label="Description"
							className="sm:col-span-2"
							required={false}
							error={vm.errors.description}
						>
							<InputArea
								value={vm.draft.description}
								maxLength={1000}
								rows={3}
								placeholder="What does this project own?"
								onChange={(event) =>
									vm.setField("description", event.target.value)
								}
							/>
						</Field>
					</fieldset>
					{project ? (
						<p className="mt-4 text-xs leading-5 text-basalt-muted-foreground">
							Changing the organization or project clears its snapshots and
							stops its watches. Changing repository scope preserves PRs and
							watches that remain in scope.
						</p>
					) : null}
					{project?.source === "demo" ? (
						<p className="mt-4 text-xs leading-5 text-basalt-muted-foreground">
							<Badge variant="info" className="mr-2">
								Demo
							</Badge>
							Scans generate sample PRs. A live Azure DevOps connection is not
							required.
						</p>
					) : null}
					{error ? (
						<AlertBanner variant="error" className="mt-4">
							{error}
						</AlertBanner>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							{busy ? "Saving…" : project ? "Save changes" : "Add project"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
