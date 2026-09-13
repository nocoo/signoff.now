import { Button, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { UsersRound } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityLabel } from "@/components/EntityAvatar";
import { Field } from "@/components/Field";
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
			/>
			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<section className="flex flex-wrap items-end gap-3">
				<Field label="Search" className="w-56">
					{(id) => (
						<Input
							id={id}
							value={vm.filter.keyword}
							placeholder="Team name"
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
									status: value as StatusFilter,
								}))
							}
						>
							<option value="active">Active</option>
							<option value="archived">Archived</option>
							<option value="all">All</option>
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
					<Button onClick={() => vm.setCreating(true)}>Add team</Button>
				</div>
			</section>

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
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-basalt-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Team
								</th>
								<th className="px-4 py-3 text-xs font-medium text-basalt-muted-foreground">
									Tags
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{vm.visible.map((t) => (
								<tr
									key={t.id}
									className="border-b border-basalt-border last:border-0 hover:bg-basalt-background/50"
								>
									<td className="px-4 py-3">
										<EntityLabel name={t.name} avatarUrl={t.avatarUrl} />
									</td>
									<td className="px-4 py-3">
										<span className="flex flex-wrap items-center gap-1.5">
											{t.tagIds.length === 0 ? (
												<span className="text-xs text-basalt-muted-foreground">
													—
												</span>
											) : (
												t.tagIds.map((id) => {
													const g = vm.tagsById.get(id);
													return g ? (
														<span
															key={id}
															className="rounded-full px-2 py-0.5 text-xs text-white"
															style={{ backgroundColor: g.color }}
														>
															{g.name}
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
											onClick={() => vm.setEditing(t)}
										>
											Edit
										</Button>
										{t.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												onClick={() => void vm.archive(t.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
												onClick={() => void vm.restore(t.id)}
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
