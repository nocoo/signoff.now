import { Badge, Button, Field, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { Users } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { EntityTag } from "@/components/EntityTag";
import { SelectControl as Select } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
import type { DeveloperFilter } from "@/models/entities";
import { useDevelopersViewModel } from "@/viewmodels/useDevelopersViewModel";
import { DeveloperDialog } from "./DeveloperDialog";

export function DevelopersPage() {
	const vm = useDevelopersViewModel();

	return (
		<div className="space-y-6">
			<PageHeader
				title="Developers"
				description="Roster used for identity matching (alias + email suffix)."
				actions={
					<>
						<p className="text-xs text-basalt-muted-foreground">
							{vm.visible.length} of {vm.items.length}
						</p>
						<Button onClick={() => vm.setCreating(true)}>Add developer</Button>
					</>
				}
			/>

			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<LayerCard
				role="search"
				aria-label="Developers filters"
				className="flex flex-wrap items-end gap-3"
			>
				<Field label="Search" className="w-56">
					<Input
						value={vm.filter.keyword}
						placeholder="Name or alias"
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
								status: value as DeveloperFilter["status"],
							}))
						}
					>
						<option value="active">Active</option>
						<option value="archived">Archived</option>
						<option value="all">All</option>
					</Select>
				</Field>
				<Field label="Team" className="w-44">
					<Select
						value={vm.filter.teamId ?? ""}
						onChange={(value) =>
							vm.setFilter((f) => ({ ...f, teamId: value || null }))
						}
					>
						<option value="">All teams</option>
						{vm.teams.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
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
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-2/3" />
				</LayerCard>
			) : vm.visible.length === 0 ? (
				<LayerCard padding="none">
					<EmptyState
						icon={Users}
						title={vm.items.length === 0 ? "No developers yet" : "No matches"}
						description={
							vm.items.length === 0
								? "Add a display name and alias. Matching uses alias@suffix from Settings."
								: "No developer matches the current filters."
						}
					/>
				</LayerCard>
			) : (
				<LayerCard padding="none" className="overflow-x-auto">
					<Table aria-label="Developers">
						<TableHeader>
							<TableRow>
								<TableHead>Developer</TableHead>
								<TableHead>Teams</TableHead>
								<TableHead>Tags</TableHead>
								<TableHead className="relative">
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{vm.visible.map((d) => (
								<TableRow key={d.id}>
									<TableCell>
										<EntityLabel
											name={d.name}
											avatarUrl={d.avatarUrl}
											secondary={d.alias}
										/>
									</TableCell>
									<TableCell>
										<span className="flex flex-wrap items-center gap-1.5">
											{d.teamIds.length === 0 ? (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											) : (
												d.teamIds.map((id) => {
													const t = vm.teamsById.get(id);
													return t ? (
														<Badge
															key={id}
															variant="secondary"
															className="gap-1"
														>
															<EntityAvatar
																name={t.name}
																avatarUrl={t.avatarUrl}
																size="sm"
															/>
															{t.name}
														</Badge>
													) : null;
												})
											)}
										</span>
									</TableCell>
									<TableCell>
										<span className="flex flex-wrap items-center gap-1.5">
											{d.tagIds.length === 0 ? (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											) : (
												d.tagIds.map((id) => {
													const t = vm.tagsById.get(id);
													return t ? <EntityTag key={id} tag={t} /> : null;
												})
											)}
										</span>
									</TableCell>
									<TableCell className="whitespace-nowrap text-right space-x-2">
										<Button
											variant="outline"
											size="sm"
											aria-label={`Edit ${d.name}`}
											onClick={() => vm.setEditing(d)}
										>
											Edit
										</Button>
										{d.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												aria-label={`Archive ${d.name}`}
												onClick={() => void vm.archive(d.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
												aria-label={`Restore ${d.name}`}
												onClick={() => void vm.restore(d.id)}
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

			<DeveloperDialog
				developer={vm.editing}
				teams={vm.teams}
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
