import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nocoo/basalt";
import { MultiSelect } from "@nocoo/basalt/components/multi-select";
import type {
	DataSource,
	DirectoryData,
	DirectoryTeam,
} from "@signoff/domain/insights";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { EntityAvatar } from "@/components/EntityAvatar";
import { useTeamMembers } from "@/viewmodels/useTeamMembers";

interface TeamMembersProps {
	source: DataSource;
	team: DirectoryTeam;
	data: DirectoryData;
	disabled: boolean;
	onAdded: () => void;
}

function TeamMembersDialog({
	source,
	team,
	data,
	onClose,
	onAdded,
}: Omit<TeamMembersProps, "disabled"> & { onClose: () => void }) {
	const vm = useTeamMembers(source, team.id);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !vm.busy) onClose();
			}}
		>
			<DialogContent className="sm:max-w-xl">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void vm.add().then((saved) => {
							if (saved) {
								onClose();
								onAdded();
							}
						});
					}}
				>
					<DialogHeader>
						<DialogTitle>Add members to {team.name}</DialogTitle>
						<DialogDescription>
							Choose followed members to add. Their other team memberships are
							preserved.
						</DialogDescription>
					</DialogHeader>
					<MultiSelect
						modal
						label="Members to add"
						value={vm.selected}
						onValueChange={vm.select}
						disabled={vm.busy}
						placeholder="Find members"
						searchPlaceholder="Name, account, or organization…"
						emptyLabel="No followed members match."
						options={data.members
							.filter(
								(member) =>
									member.archivedAt === null &&
									!data.blockedContributorKeys.includes(`member:${member.id}`),
							)
							.map((member) => ({
								value: member.id,
								label: member.name,
								description: team.memberIds.includes(member.id)
									? "Already in team"
									: data.identities
											.filter((identity) =>
												member.identityKeys.includes(identity.key),
											)
											.map(
												(identity) =>
													`${identity.handle ?? identity.actorId} · ${identity.organization}`,
											)
											.join(" · "),
								leading: (
									<EntityAvatar
										name={member.name}
										avatarUrl={member.avatarUrl}
										source={source}
										size="md"
									/>
								),
								disabled: team.memberIds.includes(member.id),
							}))}
					/>
					{vm.error ? (
						<p role="alert" className="text-sm text-basalt-destructive">
							{vm.error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={vm.busy}
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={vm.busy || vm.selected.length === 0}
						>
							{vm.busy
								? "Adding…"
								: vm.selected.length === 0
									? "Add members"
									: `Add ${vm.selected.length} ${vm.selected.length === 1 ? "member" : "members"}`}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function TeamMembersButton(props: TeamMembersProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={props.disabled}
				aria-label={`Add members to ${props.team.name}`}
				onClick={() => setOpen(true)}
			>
				<UserPlus className="h-3.5 w-3.5" aria-hidden />
				Add members
			</Button>
			{open ? (
				<TeamMembersDialog
					key={`${props.source}:${props.team.id}`}
					{...props}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}
