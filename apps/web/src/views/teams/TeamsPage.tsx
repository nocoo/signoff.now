import { UsersRound } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityLabel } from "@/components/EntityAvatar";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

			<section className="flex flex-wrap items-end gap-(--control-gap-x)">
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
							onChange={(e) =>
								vm.setFilter((f) => ({
									...f,
									status: e.target.value as StatusFilter,
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
							onChange={(e) =>
								vm.setFilter((f) => ({ ...f, tagId: e.target.value || null }))
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
					<p className="text-xs text-muted-foreground">
						{vm.visible.length} of {vm.items.length}
					</p>
					<Button onClick={() => vm.setCreating(true)}>Add team</Button>
				</div>
			</section>

			{vm.loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : vm.visible.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={UsersRound}
						title={vm.items.length === 0 ? "No teams" : "No matches"}
						description={
							vm.items.length === 0
								? "Create a team to group developers for manager filters."
								: "No team matches the current filters."
						}
					/>
				</div>
			) : (
				<div className="overflow-x-auto rounded-[var(--radius-card)] bg-secondary">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Team
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Tags
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{vm.visible.map((t) => (
								<tr
									key={t.id}
									className="border-b border-border last:border-0 hover:bg-background/50"
								>
									<td className="px-4 py-3">
										<EntityLabel name={t.name} avatarUrl={t.avatarUrl} />
									</td>
									<td className="px-4 py-3">
										<span className="flex flex-wrap items-center gap-1.5">
											{t.tagIds.length === 0 ? (
												<span className="text-xs text-muted-foreground">—</span>
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
				</div>
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
