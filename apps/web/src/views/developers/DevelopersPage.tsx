import { Users } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

			<section className="flex flex-wrap items-end gap-(--control-gap-x)">
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
							onChange={(e) =>
								vm.setFilter((f) => ({
									...f,
									status: e.target.value as DeveloperFilter["status"],
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
							onChange={(e) =>
								vm.setFilter((f) => ({ ...f, teamId: e.target.value || null }))
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
					<Button onClick={() => vm.setCreating(true)}>Add developer</Button>
				</div>
			</section>

			{vm.loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-2/3" />
				</div>
			) : vm.visible.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={Users}
						title={vm.items.length === 0 ? "No developers yet" : "No matches"}
						description={
							vm.items.length === 0
								? "Add a display name and alias. Matching uses alias@suffix from Settings."
								: "No developer matches the current filters."
						}
					/>
				</div>
			) : (
				<div className="overflow-x-auto rounded-[var(--radius-card)] bg-secondary">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Developer
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Teams
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Tags
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{vm.visible.map((d) => (
								<tr
									key={d.id}
									className="border-b border-border last:border-0 hover:bg-background/50"
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
												<span className="text-xs text-muted-foreground">—</span>
											) : (
												d.teamIds.map((id) => {
													const t = vm.teamsById.get(id);
													return t ? (
														<span
															key={id}
															className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs"
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
												<span className="text-xs text-muted-foreground">—</span>
											) : (
												d.tagIds.map((id) => {
													const t = vm.tagsById.get(id);
													return t ? (
														<span
															key={id}
															className="rounded-full px-2 py-0.5 text-xs text-white"
															style={{ backgroundColor: t.color }}
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
											onClick={() => vm.setEditing(d)}
										>
											Edit
										</Button>
										{d.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												disabled={vm.busy}
												onClick={() => void vm.archive(d.id)}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												disabled={vm.busy}
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
				</div>
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
