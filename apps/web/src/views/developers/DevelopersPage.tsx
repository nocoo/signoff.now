import { Button, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Users } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { Field } from "@/components/Field";
import { SelectControl as Select } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
import { contrastTextColor } from "@/lib/avatar";
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
			/>

			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<section className="flex flex-wrap items-end gap-3">
				<Field label="Search" className="w-56">
					{(id) => (
						<Input
							id={id}
							value={vm.filter.keyword}
							placeholder="Name or alias"
							onChange={(e) =>
								vm.setFilter((f) => ({ ...f, keyword: e.target.value }))
							}
						/>
					)}
				</Field>
				<Field label="Status" className="w-36">
					{(id) => (
						<Select
							id={id}
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
					)}
				</Field>
				<Field label="Team" className="w-44">
					{(id) => (
						<Select
							id={id}
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
					)}
				</Field>
				<Field label="Tag" className="w-44">
					{(id) => (
						<Select
							id={id}
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
					)}
				</Field>
				<div className="ml-auto flex items-center gap-3 pb-0.5">
					<p className="text-xs text-basalt-muted-foreground">
						{vm.visible.length} of {vm.items.length}
					</p>
					<Button onClick={() => vm.setCreating(true)}>Add developer</Button>
				</div>
			</section>

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
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-basalt-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Developer
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Teams
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Tags
								</th>
								<th className="px-4 py-3">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{vm.visible.map((d) => (
								<tr
									key={d.id}
									className="border-b border-basalt-border last:border-0 hover:bg-basalt-background/50"
								>
									<td className="px-4 py-3">
										<EntityLabel
											name={d.name}
											avatarUrl={d.avatarUrl}
											secondary={d.alias}
										/>
									</td>
									<td className="px-4 py-3">
										<span className="flex flex-wrap items-center gap-1.5">
											{d.teamIds.length === 0 ? (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											) : (
												d.teamIds.map((id) => {
													const t = vm.teamsById.get(id);
													return t ? (
														<span
															key={id}
															className="flex items-center gap-1 rounded-full bg-basalt-background px-2 py-0.5 text-xs"
														>
															<EntityAvatar
																name={t.name}
																avatarUrl={t.avatarUrl}
																size="sm"
															/>
															{t.name}
														</span>
													) : null;
												})
											)}
										</span>
									</td>
									<td className="px-4 py-3">
										<span className="flex flex-wrap items-center gap-1.5">
											{d.tagIds.length === 0 ? (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											) : (
												d.tagIds.map((id) => {
													const t = vm.tagsById.get(id);
													return t ? (
														<span
															key={id}
															className="rounded-full px-2 py-0.5 text-xs"
															style={{
																backgroundColor: t.color,
																color: contrastTextColor(t.color),
															}}
														>
															{t.name}
														</span>
													) : null;
												})
											)}
										</span>
									</td>
									<td className="px-4 py-3 text-right space-x-2">
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
									</td>
								</tr>
							))}
						</tbody>
					</table>
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
