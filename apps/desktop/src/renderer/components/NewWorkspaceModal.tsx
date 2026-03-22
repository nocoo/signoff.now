/**
 * NewWorkspaceModal — dialog form for creating a workspace.
 *
 * Allows selecting a project, entering a branch name, and an optional
 * workspace display name. Calls trpc.workspaces.create on submit.
 */

import { Button } from "@signoff/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@signoff/ui/dialog";
import { Input } from "@signoff/ui/input";
import { Label } from "@signoff/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@signoff/ui/select";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useNewWorkspaceModalStore } from "../stores/new-workspace-modal";

export function NewWorkspaceModal() {
	const { isOpen, preselectedProjectId, close } = useNewWorkspaceModalStore();

	const [projectId, setProjectId] = useState("");
	const [branch, setBranch] = useState("");
	const [name, setName] = useState("");

	const { data: projectList } = trpc.projects.list.useQuery();
	const utils = trpc.useUtils();

	const resetForm = useCallback(() => {
		setProjectId("");
		setBranch("");
		setName("");
	}, []);

	const createMutation = trpc.workspaces.create.useMutation({
		onSuccess: () => {
			utils.workspaces.list.invalidate();
			close();
			resetForm();
		},
	});

	// Sync preselected project when modal opens
	useEffect(() => {
		if (isOpen && preselectedProjectId) {
			setProjectId(preselectedProjectId);
		}
		if (!isOpen) {
			resetForm();
		}
	}, [isOpen, preselectedProjectId, resetForm]);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!projectId || !branch.trim()) return;

		createMutation.mutate({
			projectId,
			type: "branch",
			branch: branch.trim(),
			name: name.trim() || branch.trim(),
		});
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>New Workspace</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					{/* Project selector */}
					<div className="flex flex-col gap-2">
						<Label>Project</Label>
						<Select value={projectId} onValueChange={setProjectId}>
							<SelectTrigger>
								<SelectValue placeholder="Select a project" />
							</SelectTrigger>
							<SelectContent>
								{projectList?.map((p: { id: string; name: string }) => (
									<SelectItem key={p.id} value={p.id}>
										{p.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Branch name */}
					<div className="flex flex-col gap-2">
						<Label>Branch</Label>
						<Input
							value={branch}
							onChange={(e) => setBranch(e.target.value)}
							placeholder="feature/my-branch"
							autoFocus
						/>
					</div>

					{/* Workspace display name */}
					<div className="flex flex-col gap-2">
						<Label>Name (optional)</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={branch || "Workspace name"}
						/>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={close}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={
								!projectId || !branch.trim() || createMutation.isPending
							}
						>
							{createMutation.isPending ? "Creating…" : "Create Workspace"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
