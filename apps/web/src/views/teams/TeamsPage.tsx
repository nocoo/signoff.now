import { Button, Field, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { UsersRound } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityLabel } from "@/components/EntityAvatar";
import { EntityTag } from "@/components/EntityTag";
import { SelectControl as Select } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
import type { StatusFilter } from "@/models/entities";
import { useTeamsViewModel } from "@/viewmodels/useTeamsViewModel";
import { TeamDialog } from "./TeamDialog";

export function TeamsPage() {
	const vm = useTeamsViewModel();

	return (
		<div className="space-y-6">
			<PageHeader
				title="Teams"
				description="Organize developers into multi-membership groups for filtering."
				actions={
					<>
						<p className="text-xs text-basalt-muted-foreground">
							{vm.visible.length} of {vm.items.length}
						</p>
						<Button onClick={() => vm.setCreating(true)}>Add team</Button>
					</>
				}
			/>
			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<LayerCard
				role="search"
				aria-label="Teams filters"
				className="flex flex-wrap items-end gap-3"
			>
				<Field label="Search" className="w-56">
					<Input
						value={vm.filter.keyword}
						placeholder="Team name"
						onChange={(e) =>
							vm.setFilter((f) => ({ ...f, keyword: e.target.value }))
						}
					/>
				</Field>
				<Field label="Status" className="w-36">
					<Select
						value={vm.filter.status}
						onChange={(value) =>
							vm.setFilter((f) => ({
								...f,
								status: value as StatusFilter,
							}))
						}
					>
						<option value="active">Active</option>
						<option value="archived">Archived</option>
						<option value="all">All</option>
					</Select>
				</Field>
				<Field label="Tag" className="w-44">
					<Select
						value={vm.filter.tagId ?? ""}
						onChange={(value) =>
							vm.setFilter((f) => ({ ...f, tagId: value || null }))
						}
					>
						<option value="">All tags</option>
						{vm.tags.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</Select>
				</Field>
			</LayerCard>

			{vm.loading ? (
				<LayerCard className="space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</LayerCard>
			) : vm.visible.length === 0 ? (
				<LayerCard padding="none">
					<EmptyState
						icon={UsersRound}
						title={vm.items.length === 0 ? "No teams" : "No matches"}
						description={
							vm.items.length === 0
								? "Create a team to group developers for manager filters."
								: "No team matches the current filters."
						}
					/>
				</LayerCard>
			) : (
				<LayerCard padding="none" className="overflow-x-auto">
					<Table aria-label="Teams">
						<TableHeader>
							<TableRow>
								<TableHead>Team</TableHead>
								<TableHead>Tags</TableHead>
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{vm.visible.map((t) => (
								<TableRow key={t.id}>
									<TableCell>
										<EntityLabel name={t.name} avatarUrl={t.avatarUrl} />
									</TableCell>
									<TableCell>
										<span className="flex flex-wrap items-center gap-1.5">
											{t.tagIds.length === 0 ? (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											) : (
												t.tagIds.map((id) => {
													const g = vm.tagsById.get(id);
													return g ? <EntityTag key={id} tag={g} /> : null;
												})
											)}
										</span>
									</TableCell>
									<TableCell className="whitespace-nowrap text-right space-x-2">
										<Button
											variant="outline"
											size="sm"
											aria-label={`Edit ${t.name}`}
											onClick={() => vm.setEditing(t)}
										>
											Edit
										</Button>
										{t.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												aria-label={`Archive ${t.name}`}
												onClick={() => void vm.archive(t.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
												aria-label={`Restore ${t.name}`}
												onClick={() => void vm.restore(t.id)}
											>
												Restore
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</LayerCard>
			)}

			<TeamDialog
				team={vm.editing}
				tags={vm.tags}
				open={vm.dialogOpen}
				onOpenChange={(o) => {
					if (!o) {
						vm.closeDialog();
					}
				}}
				onSubmit={vm.submit}
				onCreateTag={vm.addTag}
			/>
		</div>
	);
}
