import { Users } from "lucide-react";
import { useId, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeveloperFilter } from "@/models/entities";
import { useDevelopersViewModel } from "@/viewmodels/useDevelopersViewModel";
import { DeveloperDialog } from "./DeveloperDialog";

export function DevelopersPage() {
	const vm = useDevelopersViewModel();
	// Only the "add developer" inputs are local: they are transient text that
	// nothing outside this form reads.
	const [name, setName] = useState("");
	const [alias, setAlias] = useState("");
	const searchId = useId();
	const statusId = useId();
	const teamId = useId();

	const onCreate = async () => {
		if (await vm.create(name, alias)) {
			setName("");
			setAlias("");
		}
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title="Developers"
				description="Roster used for identity matching (alias + email suffix)."
			/>

			{vm.error ? <AlertBanner variant="error">{vm.error}</AlertBanner> : null}

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3">
				<h2 className="font-display text-base font-semibold">Add developer</h2>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label htmlFor="dev-name">Name</Label>
						<Input
							id="dev-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Display name"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="dev-alias">Alias</Label>
						<Input
							id="dev-alias"
							value={alias}
							onChange={(e) => setAlias(e.target.value)}
							placeholder="ada"
						/>
					</div>
				</div>
				<Button disabled={vm.busy} onClick={() => void onCreate()}>
					{vm.busy ? "Creating…" : "Create"}
				</Button>
			</section>

			<section className="flex flex-wrap items-end gap-3">
				<div className="space-y-1.5">
					<Label htmlFor={searchId}>Search</Label>
					<Input
						id={searchId}
						className="w-56"
						value={vm.filter.keyword}
						placeholder="Name or alias"
						onChange={(e) =>
							vm.setFilter((f) => ({ ...f, keyword: e.target.value }))
						}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={statusId}>Status</Label>
					<select
						id={statusId}
						className="h-9 rounded-md border border-border bg-background px-2 text-sm"
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
					</select>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={teamId}>Team</Label>
					<select
						id={teamId}
						className="h-9 rounded-md border border-border bg-background px-2 text-sm"
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
					</select>
				</div>
				<p className="ml-auto text-xs text-muted-foreground">
					{vm.visible.length} of {vm.items.length}
				</p>
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
				open={vm.editing !== null}
				onOpenChange={(o) => {
					if (!o) {
						vm.setEditing(null);
					}
				}}
				onSubmit={vm.submitEdit}
			/>
		</div>
	);
}
