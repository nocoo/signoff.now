import {
	Badge,
	Button,
	Field,
	Input,
	LayerCard,
	SegmentControl,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import type {
	DataSource,
	DirectoryData,
	DirectoryMember,
	DirectoryTag,
} from "@signoff/domain/insights";
import {
	ArrowUpRight,
	Plus,
	RefreshCw,
	Tag,
	UserPlus,
	Users,
} from "lucide-react";
import { Link } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { ContributorProfile } from "@/components/ContributorProfile";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { EntityTag } from "@/components/EntityTag";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import type { DirectoryFilter, DirectoryKind } from "@/models/directory";
import {
	type DirectoryViewModel,
	useDirectoryViewModel,
} from "@/viewmodels/useDirectoryViewModel";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";
import { DirectoryDialog } from "./DirectoryDialog";
import { TeamMembersButton } from "./TeamMembersButton";

const pages = {
	members: {
		title: "Members",
		noun: "member",
		icon: Users,
		description:
			"Follow PR authors, link their accounts, and organize the people you care about.",
	},
	teams: {
		title: "Teams",
		noun: "team",
		icon: Users,
		description:
			"Manage team membership and explore each team's PR contributions.",
	},
	tags: {
		title: "Tags",
		noun: "tag",
		icon: Tag,
		description:
			"Label members and teams to focus contribution reports on the groups you care about.",
	},
};

function insightLink(
	source: DataSource,
	filter: { contributor?: string; team?: string; tag?: string },
) {
	return `/insights?${new URLSearchParams({ source, ...filter })}`;
}

function RowActions({
	vm,
	row,
}: {
	vm: DirectoryViewModel;
	row: { id: string; name: string; archivedAt: number | null };
}) {
	return (
		<div className="flex flex-wrap justify-end gap-1.5">
			{row.archivedAt === null ? (
				<Button
					variant="outline"
					size="sm"
					disabled={vm.busy}
					aria-label={`Edit ${row.name}`}
					onClick={() => vm.edit(row.id)}
				>
					Edit
				</Button>
			) : null}
			<Button
				variant="ghost"
				size="sm"
				disabled={vm.busy}
				aria-label={`${row.archivedAt === null ? "Archive" : "Restore"} ${row.name}`}
				onClick={() => void vm.setArchived(row.id, row.archivedAt === null)}
			>
				{row.archivedAt === null ? "Archive" : "Restore"}
			</Button>
		</div>
	);
}

function Tags({ tags, ids }: { tags: DirectoryTag[]; ids: string[] }) {
	return (
		<span className="flex flex-wrap gap-1.5">
			{ids.length === 0 ? (
				<span className="text-xs text-basalt-muted-foreground">No tags</span>
			) : (
				tags
					.filter((tag) => ids.includes(tag.id))
					.map((tag) => <EntityTag key={tag.id} tag={tag} />)
			)}
		</span>
	);
}

function MemberTeams({
	member,
	data,
	source,
}: {
	member: DirectoryMember;
	data: DirectoryData;
	source: DataSource;
}) {
	return (
		<span className="flex flex-wrap gap-1.5">
			{member.teamIds.length === 0 ? (
				<span className="text-xs text-basalt-muted-foreground">
					No team assigned
				</span>
			) : (
				data.teams
					.filter((team) => member.teamIds.includes(team.id))
					.map((team) => {
						const label = (
							<Badge
								key={team.id}
								variant="secondary"
								className="max-w-full gap-1.5 whitespace-normal break-words"
							>
								<EntityAvatar
									name={team.name}
									avatarUrl={team.avatarUrl}
									size="xs"
								/>
								{team.name}
								{team.archivedAt !== null ? " (archived)" : ""}
							</Badge>
						);
						return team.archivedAt === null ? (
							<Link
								key={team.id}
								to={insightLink(source, { team: team.id })}
								className="max-w-full rounded-basalt-sm hover:underline"
							>
								{label}
							</Link>
						) : (
							label
						);
					})
			)}
		</span>
	);
}

function MembersTable({
	vm,
	source,
}: {
	vm: DirectoryViewModel;
	source: DataSource;
}) {
	const data = vm.data;
	if (!data) return null;
	return (
		<LayerCard padding="none" className="overflow-x-auto">
			<Table aria-label="Followed members">
				<TableHeader>
					<TableRow>
						<TableHead>Member</TableHead>
						<TableHead>Linked accounts</TableHead>
						<TableHead>Teams</TableHead>
						<TableHead>Tags</TableHead>
						<TableHead>
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{vm.members.map((member) => (
						<TableRow key={member.id}>
							<TableCell className="min-w-44">
								<ContributorProfile
									source={source}
									contributorKey={`member:${member.id}`}
									name={member.name}
									avatarUrl={member.avatarUrl}
								/>
								{member.archivedAt !== null ? (
									<Badge variant="secondary" className="mt-1.5">
										Archived
									</Badge>
								) : null}
							</TableCell>
							<TableCell className="min-w-48 max-w-72">
								{member.identityKeys.length === 0 ? (
									<span className="text-xs text-basalt-muted-foreground">
										No accounts linked
									</span>
								) : (
									<ul className="space-y-1.5">
										{data.identities
											.filter((identity) =>
												member.identityKeys.includes(identity.key),
											)
											.map((identity) => (
												<li key={identity.key} className="min-w-0 text-xs">
													<div
														className="truncate"
														title={identity.handle ?? identity.name}
													>
														{identity.handle ?? identity.name}
													</div>
													<div className="truncate text-basalt-muted-foreground">
														{identity.provider === "ado" ? "ADO" : "GitHub"} ·{" "}
														{identity.organization}
													</div>
												</li>
											))}
									</ul>
								)}
							</TableCell>
							<TableCell className="min-w-40">
								<MemberTeams member={member} data={data} source={source} />
							</TableCell>
							<TableCell>
								<Tags tags={data.tags} ids={member.tagIds} />
							</TableCell>
							<TableCell className="min-w-56">
								<div className="flex flex-wrap items-center justify-end gap-1.5">
									{member.archivedAt === null ? (
										<Button asChild variant="ghost" size="sm">
											<Link
												to={insightLink(source, {
													contributor: `member:${member.id}`,
												})}
											>
												Contributions
												<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
											</Link>
										</Button>
									) : null}
									<RowActions vm={vm} row={member} />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</LayerCard>
	);
}

function AuthorsTable({ vm }: { vm: DirectoryViewModel }) {
	const blocked = vm.filter.view === "blocked";
	return (
		<LayerCard padding="none">
			<LayerCard.Header>
				<p className="text-sm text-basalt-muted-foreground">
					{blocked
						? "Hidden contributors are excluded from reports. Open a profile to unhide them."
						: "Authors from collected PRs who have not been linked to a followed member. Open a profile to hide an author."}
				</p>
			</LayerCard.Header>
			<div className="overflow-x-auto">
				<Table
					aria-label={blocked ? "Hidden contributors" : "Discover PR authors"}
				>
					<TableHeader>
						<TableRow>
							<TableHead>Author</TableHead>
							<TableHead>Account</TableHead>
							<TableHead>Organization</TableHead>
							<TableHead>
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{vm.authors.map((identity) => (
							<TableRow key={identity.key}>
								<TableCell className="min-w-48">
									<ContributorProfile
										source={vm.data?.source ?? "cli"}
										contributorKey={`identity:${identity.key}`}
										name={identity.name}
										avatarUrl={identity.avatarUrl}
									/>
								</TableCell>
								<TableCell className="max-w-72">
									<span
										className="block truncate text-xs"
										title={identity.handle ?? identity.actorId}
									>
										{identity.handle ?? identity.actorId}
									</span>
								</TableCell>
								<TableCell>
									<Badge variant="secondary">
										{identity.provider === "ado" ? "ADO" : "GitHub"}
									</Badge>
									<span className="ml-2 text-xs">{identity.organization}</span>
								</TableCell>
								<TableCell className="text-right">
									<Button
										size="sm"
										variant="outline"
										disabled={vm.busy || blocked}
										aria-label={`Follow ${identity.name}`}
										onClick={() => vm.follow(identity.key)}
									>
										<UserPlus className="h-3.5 w-3.5" aria-hidden />
										Follow
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</LayerCard>
	);
}

function BlockedContributors({ vm }: { vm: DirectoryViewModel }) {
	const data = vm.data;
	if (!data) return null;
	const blocked = new Set(data.blockedContributorKeys);
	const members = data.members.filter((member) =>
		blocked.has(`member:${member.id}`),
	);
	const rows = [
		...members.map((member) => ({ ...member, key: `member:${member.id}` })),
		...data.identities
			.filter(
				(identity) =>
					blocked.has(`identity:${identity.key}`) &&
					!members.some((member) => member.id === identity.memberId),
			)
			.map((identity) => ({ ...identity, key: `identity:${identity.key}` })),
	].filter((row) =>
		row.name
			.toLocaleLowerCase()
			.includes(vm.filter.keyword.trim().toLocaleLowerCase()),
	);
	return (
		<LayerCard className="space-y-3">
			<p className="text-sm text-basalt-muted-foreground">
				Hidden contributors are excluded from reports. Open a profile to unhide
				them.
			</p>
			{rows.length ? (
				<ul
					className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
					aria-label="Hidden contributors"
				>
					{rows.map((row) => (
						<li key={row.key}>
							<ContributorProfile
								source={data.source}
								contributorKey={row.key}
								name={row.name}
								avatarUrl={row.avatarUrl}
								secondary="Hidden"
							/>
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm">No hidden contributors</p>
			)}
		</LayerCard>
	);
}

function TeamsGrid({
	vm,
	source,
}: {
	vm: DirectoryViewModel;
	source: DataSource;
}) {
	const data = vm.data;
	if (!data) return null;
	return (
		<div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
			{vm.teams.map((team) => (
				<LayerCard
					key={team.id}
					padding="none"
					className="min-w-0 flex flex-col"
				>
					<LayerCard.Header className="flex items-center justify-between gap-3">
						<EntityLabel
							name={team.name}
							avatarUrl={team.avatarUrl}
							size="lg"
						/>
						{team.archivedAt !== null ? (
							<Badge variant="secondary">Archived</Badge>
						) : null}
					</LayerCard.Header>
					<LayerCard.Body className="flex-1 space-y-4">
						<Tags tags={data.tags} ids={team.tagIds} />
						<div className="space-y-2">
							<p className="text-xs font-medium text-basalt-muted-foreground">
								Members
							</p>
							{team.memberIds.length === 0 ? (
								<p className="py-3 text-sm text-basalt-muted-foreground">
									No members assigned yet.
								</p>
							) : (
								<ul
									aria-label={`${team.name} members`}
									className="max-h-60 space-y-3 overflow-y-auto pr-1"
								>
									{data.members
										.filter((member) => team.memberIds.includes(member.id))
										.map((member) => (
											<li key={member.id}>
												<ContributorProfile
													source={source}
													contributorKey={`member:${member.id}`}
													name={member.name}
													avatarUrl={member.avatarUrl}
													secondary={
														member.archivedAt !== null ? "Archived" : undefined
													}
												/>
											</li>
										))}
								</ul>
							)}
						</div>
					</LayerCard.Body>
					<LayerCard.Footer className="flex flex-wrap items-center justify-between gap-2">
						{team.archivedAt === null ? (
							<Button asChild variant="ghost" size="sm">
								<Link to={insightLink(source, { team: team.id })}>
									Contributions
									<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
								</Link>
							</Button>
						) : null}
						<div className="flex flex-wrap items-center gap-1.5">
							{team.archivedAt === null ? (
								<TeamMembersButton
									source={source}
									team={team}
									data={data}
									disabled={vm.busy}
									onAdded={() => void vm.reload()}
								/>
							) : null}
							<RowActions vm={vm} row={team} />
						</div>
					</LayerCard.Footer>
				</LayerCard>
			))}
		</div>
	);
}

function TagsTable({
	vm,
	source,
}: {
	vm: DirectoryViewModel;
	source: DataSource;
}) {
	return (
		<LayerCard padding="none" className="overflow-x-auto">
			<Table aria-label="Directory tags">
				<TableHeader>
					<TableRow>
						<TableHead>Tag</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{vm.tags.map((tag) => (
						<TableRow key={tag.id}>
							<TableCell>
								<EntityTag tag={tag} />
							</TableCell>
							<TableCell>
								<span className="text-xs text-basalt-muted-foreground">
									{tag.archivedAt === null ? "Active" : "Archived"}
								</span>
							</TableCell>
							<TableCell>
								<div className="flex flex-wrap items-center justify-end gap-2">
									{tag.archivedAt === null ? (
										<Button asChild variant="ghost" size="sm">
											<Link to={insightLink(source, { tag: tag.id })}>
												Contributions
												<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
											</Link>
										</Button>
									) : null}
									<RowActions vm={vm} row={tag} />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</LayerCard>
	);
}

function DirectoryFilters({
	vm,
	kind,
}: {
	vm: DirectoryViewModel;
	kind: DirectoryKind;
}) {
	const discovering = kind === "members" && vm.filter.view === "discover";
	return (
		<LayerCard
			role="search"
			aria-label={`${pages[kind].title} filters`}
			className="space-y-4"
		>
			{kind === "members" ? (
				<SegmentControl
					legend={<span className="sr-only">Member view</span>}
					value={vm.filter.view}
					onValueChange={(value) =>
						vm.setFilter({ view: value as DirectoryFilter["view"] })
					}
					options={[
						{ value: "followed", label: "Followed members" },
						{ value: "discover", label: "Discover authors" },
						{ value: "blocked", label: "Hidden" },
					]}
				/>
			) : null}
			<div className="flex flex-wrap items-end gap-3">
				<Field label="Search" className="w-full sm:w-64">
					<Input
						value={vm.filter.keyword}
						onChange={(event) => vm.setFilter({ keyword: event.target.value })}
						placeholder={
							kind === "members"
								? "Name, account, or organization…"
								: `Search ${kind}…`
						}
					/>
				</Field>
				{!discovering ? (
					<Field label="Status" className="w-36">
						<SelectControl
							value={vm.filter.status}
							onChange={(status) =>
								vm.setFilter({ status: status as DirectoryFilter["status"] })
							}
						>
							<option value="active">Active</option>
							<option value="archived">Archived</option>
							<option value="all">All</option>
						</SelectControl>
					</Field>
				) : null}
				{kind === "members" && !discovering ? (
					<Field label="Team" className="w-44">
						<SelectControl
							value={vm.filter.teamId}
							onChange={(teamId) => vm.setFilter({ teamId })}
						>
							<option value="">All teams</option>
							{vm.data?.teams.map((team) => (
								<option key={team.id} value={team.id}>
									{team.name}
									{team.archivedAt !== null ? " (archived)" : ""}
								</option>
							))}
						</SelectControl>
					</Field>
				) : null}
				{kind !== "tags" && !discovering ? (
					<Field label="Tag" className="w-44">
						<SelectControl
							value={vm.filter.tagId}
							onChange={(tagId) => vm.setFilter({ tagId })}
						>
							<option value="">All tags</option>
							{vm.data?.tags.map((tag) => (
								<option key={tag.id} value={tag.id}>
									{tag.name}
									{tag.archivedAt !== null ? " (archived)" : ""}
								</option>
							))}
						</SelectControl>
					</Field>
				) : null}
				<Button variant="ghost" size="sm" onClick={vm.resetFilter}>
					Reset filters
				</Button>
			</div>
		</LayerCard>
	);
}

function DirectoryContent({
	vm,
	kind,
	source,
}: {
	vm: DirectoryViewModel;
	kind: DirectoryKind;
	source: DataSource;
}) {
	const page = pages[kind];
	const discovering = kind === "members" && vm.filter.view === "discover";
	const empty = (discovering ? vm.authors : vm[kind]).length === 0;
	if (vm.filter.view === "blocked" && kind === "members")
		return <BlockedContributors vm={vm} />;
	if (vm.loading)
		return (
			<LayerCard>
				<LayerCard.Loading label="Loading directory" />
			</LayerCard>
		);
	if (empty)
		return (
			<LayerCard padding="none">
				<EmptyState
					icon={discovering ? UserPlus : page.icon}
					title={
						discovering ? "No unfollowed authors found" : `No ${kind} found`
					}
					description={
						discovering
							? "Authors appear here after their PRs are collected. Search by name, email, or organization."
							: kind === "members"
								? "Discover PR authors to follow, add a member, or adjust the filters."
								: `Add a ${page.noun} or adjust the filters to get started.`
					}
					action={
						kind === "members" && !discovering ? (
							<Button
								variant="outline"
								onClick={() => vm.setFilter({ view: "discover", keyword: "" })}
							>
								Discover authors
							</Button>
						) : undefined
					}
				/>
			</LayerCard>
		);
	if (discovering) return <AuthorsTable vm={vm} />;
	if (kind === "members") return <MembersTable vm={vm} source={source} />;
	if (kind === "teams") return <TeamsGrid vm={vm} source={source} />;
	return <TagsTable vm={vm} source={source} />;
}

function DirectoryPage({ kind }: { kind: DirectoryKind }) {
	const source = useWorkbench().filter.source;
	const vm = useDirectoryViewModel(source, kind);
	const page = pages[kind];
	return (
		<div className="space-y-5">
			<PageHeader
				title={page.title}
				description={page.description}
				actions={
					<>
						<Button
							variant="outline"
							size="sm"
							disabled={vm.busy || vm.refreshing}
							onClick={() => void vm.reload()}
							aria-label="Reload directory"
						>
							<RefreshCw
								className={cn(
									"h-3.5 w-3.5",
									vm.refreshing && "motion-safe:animate-spin",
								)}
								aria-hidden
							/>
							Reload
						</Button>
						<Button disabled={vm.busy || !vm.data} onClick={() => vm.edit()}>
							<Plus className="h-4 w-4" aria-hidden />
							Add {page.noun}
						</Button>
					</>
				}
			/>
			{vm.error ? (
				<AlertBanner variant="error">
					{vm.error}
					{vm.data
						? " Showing the last loaded directory."
						: " Reload to try again."}
				</AlertBanner>
			) : null}
			<DirectoryFilters vm={vm} kind={kind} />
			<DirectoryContent vm={vm} kind={kind} source={source} />
			<DirectoryDialog vm={vm} />
		</div>
	);
}

export function MembersPage() {
	return <DirectoryPage kind="members" />;
}
export function DirectoryTeamsPage() {
	return <DirectoryPage kind="teams" />;
}
export function DirectoryTagsPage() {
	return <DirectoryPage kind="tags" />;
}
