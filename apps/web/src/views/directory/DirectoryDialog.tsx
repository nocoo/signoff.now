import {
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
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import { EntityAvatar } from "@/components/EntityAvatar";
import { EntityTag } from "@/components/EntityTag";
import { SelectControl } from "@/components/SelectControl";
import type { DirectoryViewModel } from "@/viewmodels/useDirectoryViewModel";

const nouns = { members: "member", teams: "team", tags: "tag" };

export function DirectoryDialog({ vm }: { vm: DirectoryViewModel }) {
	const editor = vm.editor;
	const data = vm.data;
	if (!editor || !data) return null;
	const noun = nouns[editor.kind];
	const title = editor.followKey
		? "Follow PR author"
		: `${editor.id === null ? "Add" : "Edit"} ${noun}`;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) vm.closeEditor();
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						void vm.save();
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							{editor.kind === "members"
								? "Link the accounts this person uses, then choose their teams and tags."
								: editor.kind === "teams"
									? "Choose the members who belong to this team."
									: "Use tags to organize members and teams for contribution filters."}
						</DialogDescription>
					</DialogHeader>

					{editor.followKey ? (
						<Field
							label="Follow as"
							hint="Create a member or add this account to someone you already follow."
						>
							<SelectControl
								value={editor.id ?? ""}
								disabled={vm.busy}
								onChange={(id) => vm.chooseFollowMember(id || null)}
							>
								<option value="">New member</option>
								{data.members
									.filter((member) => member.archivedAt === null)
									.map((member) => (
										<option key={member.id} value={member.id}>
											{member.name}
										</option>
									))}
							</SelectControl>
						</Field>
					) : null}

					<div className="flex items-end gap-3">
						{editor.kind !== "tags" ? (
							<EntityAvatar
								name={editor.draft.name}
								avatarUrl={editor.draft.avatarUrl}
								size="lg"
							/>
						) : null}
						<Field label="Name" className="min-w-0 flex-1">
							<Input
								value={editor.draft.name}
								disabled={vm.busy}
								required
								maxLength={240}
								onChange={(event) =>
									vm.updateDraft({ name: event.target.value })
								}
								placeholder={
									editor.kind === "members"
										? "Display name"
										: editor.kind === "teams"
											? "Team name"
											: "Tag name"
								}
							/>
						</Field>
					</div>
					{editor.kind !== "tags" ? (
						<Field
							label="Avatar URL"
							hint="Optional. A missing image uses two initials."
						>
							<Input
								type="url"
								value={editor.draft.avatarUrl ?? ""}
								disabled={vm.busy}
								placeholder="https://…"
								onChange={(event) =>
									vm.updateDraft({
										avatarUrl: event.target.value.trim() || null,
									})
								}
							/>
						</Field>
					) : (
						<div className="flex items-end gap-3">
							<Field label="Color">
								<Input
									type="color"
									className="w-20 p-1"
									value={editor.draft.color}
									disabled={vm.busy}
									onChange={(event) =>
										vm.updateDraft({ color: event.target.value })
									}
								/>
							</Field>
							<EntityTag
								tag={{
									name: editor.draft.name || "Tag",
									color: editor.draft.color,
								}}
							/>
						</div>
					)}

					{editor.kind === "members" ? (
						<>
							<div className="space-y-1.5">
								<MultiSelect
									label="Linked accounts"
									value={editor.draft.identityKeys}
									onValueChange={(identityKeys) =>
										vm.updateDraft({ identityKeys })
									}
									disabled={vm.busy}
									placeholder="Find PR author accounts"
									searchPlaceholder="Name, email, or organization…"
									emptyLabel="No collected author accounts match."
									options={data.identities.map((identity) => ({
										value: identity.key,
										label: `${identity.name} · ${identity.handle ?? identity.actorId}`,
										description: `${identity.provider === "ado" ? "ADO" : "GitHub"} · ${identity.organization}${identity.memberId !== null && identity.memberId !== editor.id ? ` · Linked to ${data.members.find((member) => member.id === identity.memberId)?.name ?? "another member"}` : ""}`,
										leading: (
											<EntityAvatar
												name={identity.name}
												avatarUrl={identity.avatarUrl}
												size="sm"
											/>
										),
										disabled:
											identity.memberId !== null &&
											identity.memberId !== editor.id,
									}))}
								/>
								<p className="text-xs text-basalt-muted-foreground">
									Each account can belong to one member. You can link accounts
									across organizations.
								</p>
							</div>
							<MultiSelect
								label="Teams"
								value={editor.draft.teamIds}
								onValueChange={(teamIds) => vm.updateDraft({ teamIds })}
								disabled={vm.busy}
								placeholder="Choose teams"
								options={data.teams.map((team) => ({
									value: team.id,
									label: `${team.name}${team.archivedAt !== null ? " (archived)" : ""}`,
									leading: (
										<EntityAvatar
											name={team.name}
											avatarUrl={team.avatarUrl}
											size="sm"
										/>
									),
									disabled:
										team.archivedAt !== null &&
										!editor.draft.teamIds.includes(team.id),
								}))}
							/>
						</>
					) : null}
					{editor.kind === "teams" ? (
						<MultiSelect
							label="Members"
							value={editor.draft.memberIds}
							onValueChange={(memberIds) => vm.updateDraft({ memberIds })}
							disabled={vm.busy}
							placeholder="Choose team members"
							options={data.members.map((member) => ({
								value: member.id,
								label: `${member.name}${member.archivedAt !== null ? " (archived)" : ""}`,
								leading: (
									<EntityAvatar
										name={member.name}
										avatarUrl={member.avatarUrl}
										size="sm"
									/>
								),
								disabled:
									member.archivedAt !== null &&
									!editor.draft.memberIds.includes(member.id),
							}))}
						/>
					) : null}
					{editor.kind !== "tags" ? (
						<MultiSelect
							label="Tags"
							value={editor.draft.tagIds}
							onValueChange={(tagIds) => vm.updateDraft({ tagIds })}
							disabled={vm.busy}
							placeholder="Choose tags"
							options={data.tags.map((tag) => ({
								value: tag.id,
								label: `${tag.name}${tag.archivedAt !== null ? " (archived)" : ""}`,
								leading: (
									<span
										className="h-2 w-2 rounded-full"
										style={{ backgroundColor: tag.color }}
									/>
								),
								disabled:
									tag.archivedAt !== null &&
									!editor.draft.tagIds.includes(tag.id),
							}))}
						/>
					) : null}

					{vm.formError ? (
						<p role="alert" className="text-sm text-basalt-destructive">
							{vm.formError}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={vm.busy}
							onClick={vm.closeEditor}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={vm.busy}>
							{vm.busy
								? "Saving…"
								: editor.followKey && editor.id === null
									? "Follow author"
									: editor.id === null
										? "Create"
										: "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
