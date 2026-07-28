import { Users } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityAvatar, EntityLabel } from "@/components/EntityAvatar";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Developer, DeveloperFilter, Team } from "@/models/entities";
import {
	EMPTY_DEVELOPER_FILTER,
	filterDevelopers,
	validateDeveloperInput,
} from "@/models/entities";
import {
	archiveDeveloper,
	createDeveloper,
	listDevelopers,
	listTeams,
	patchDeveloper,
	restoreDeveloper,
} from "@/models/entitiesApi";
import { DeveloperDialog, type DeveloperDraft } from "./DeveloperDialog";

export function DevelopersPage() {
	const [items, setItems] = useState<Developer[]>([]);
	const [teams, setTeams] = useState<Team[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [alias, setAlias] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState<DeveloperFilter>(EMPTY_DEVELOPER_FILTER);
	const [editing, setEditing] = useState<Developer | null>(null);
	const searchId = useId();
	const statusId = useId();
	const teamId = useId();

	const reload = useCallback(async () => {
		// Archived rows are fetched always and hidden by the filter, so
		// switching status does not need a round trip.
		//
		// allSettled, not all: the team list only decorates the roster and fills
		// one filter. Letting it reject would throw away developers that loaded
		// fine and leave the page empty — the one screen where the roster is the
		// entire point.
		const [devs, tms] = await Promise.allSettled([
			listDevelopers(true),
			listTeams(),
		]);
		if (devs.status === "fulfilled") {
			setItems(devs.value);
		}
		if (tms.status === "fulfilled") {
			setTeams(tms.value);
		}
		const failed = [devs, tms].find((r) => r.status === "rejected");
		setError(
			failed === undefined
				? null
				: failed.reason instanceof Error
					? failed.reason.message
					: "Load failed",
		);
		setLoading(false);
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const visible = useMemo(
		() => filterDevelopers(items, filter),
		[items, filter],
	);
	const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

	const onCreate = async () => {
		const v = validateDeveloperInput(name, alias);
		if (v) {
			setError(v);
			return;
		}
		setBusy(true);
		try {
			await createDeveloper(name, alias);
			setName("");
			setAlias("");
			await reload();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Create failed");
		} finally {
			setBusy(false);
		}
	};

	const onSubmitEdit = async (draft: DeveloperDraft) => {
		if (!editing) {
			return;
		}
		await patchDeveloper(editing.id, {
			name: draft.name,
			alias: draft.alias,
			avatarUrl: draft.avatarUrl.trim() || null,
			teamIds: draft.teamIds,
		});
		await reload();
	};

	const run = (p: Promise<unknown>) =>
		void p.then(reload).catch((e: Error) => setError(e.message));

	return (
		<div className="space-y-6">
			<PageHeader
				title="Developers"
				description="Roster used for identity matching (alias + email suffix)."
			/>

			{error ? <AlertBanner variant="error">{error}</AlertBanner> : null}

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
				<Button disabled={busy} onClick={() => void onCreate()}>
					{busy ? "Creating…" : "Create"}
				</Button>
			</section>

			<section className="flex flex-wrap items-end gap-3">
				<div className="space-y-1.5">
					<Label htmlFor={searchId}>Search</Label>
					<Input
						id={searchId}
						className="w-56"
						value={filter.keyword}
						placeholder="Name or alias"
						onChange={(e) =>
							setFilter((f) => ({ ...f, keyword: e.target.value }))
						}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={statusId}>Status</Label>
					<select
						id={statusId}
						className="h-9 rounded-md border border-border bg-background px-2 text-sm"
						value={filter.status}
						onChange={(e) =>
							setFilter((f) => ({
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
						value={filter.teamId ?? ""}
						onChange={(e) =>
							setFilter((f) => ({ ...f, teamId: e.target.value || null }))
						}
					>
						<option value="">All teams</option>
						{teams.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</select>
				</div>
				<p className="ml-auto text-xs text-muted-foreground">
					{visible.length} of {items.length}
				</p>
			</section>

			{loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-2/3" />
				</div>
			) : visible.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={Users}
						title={items.length === 0 ? "No developers yet" : "No matches"}
						description={
							items.length === 0
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
							{visible.map((d) => (
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
													const t = teamName.get(id);
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
											onClick={() => setEditing(d)}
										>
											Edit
										</Button>
										{d.archivedAt === null ? (
											<Button
												variant="destructive"
												size="sm"
												onClick={() => run(archiveDeveloper(d.id))}
											>
												Archive
											</Button>
										) : (
											<Button
												variant="outline"
												size="sm"
												onClick={() => run(restoreDeveloper(d.id))}
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
				developer={editing}
				teams={teams}
				open={editing !== null}
				onOpenChange={(o) => {
					if (!o) {
						setEditing(null);
					}
				}}
				onSubmit={onSubmitEdit}
			/>
		</div>
	);
}
