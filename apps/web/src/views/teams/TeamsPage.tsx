import { UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityLabel } from "@/components/EntityAvatar";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Team } from "@/models/entities";
import {
	archiveTeam,
	createTeam,
	listTeams,
	patchTeam,
} from "@/models/entitiesApi";
import { TeamDialog, type TeamDraft } from "./TeamDialog";

export function TeamsPage() {
	const [items, setItems] = useState<Team[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [editing, setEditing] = useState<Team | null>(null);

	const reload = useCallback(async () => {
		try {
			setItems(await listTeams());
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Load failed");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	return (
		<div className="space-y-6">
			<PageHeader
				title="Teams"
				description="Organize developers into multi-membership groups for filtering."
			/>
			{error ? <AlertBanner variant="error">{error}</AlertBanner> : null}

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
				<div className="flex max-w-md flex-col gap-2 sm:flex-row">
					<Input
						placeholder="Team name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void createTeam(name)
									.then(() => {
										setName("");
										return reload();
									})
									.catch((err: Error) => setError(err.message));
							}
						}}
					/>
					<Button
						onClick={() =>
							void createTeam(name)
								.then(() => {
									setName("");
									return reload();
								})
								.catch((e: Error) => setError(e.message))
						}
					>
						Add
					</Button>
				</div>
			</section>

			{loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : items.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={UsersRound}
						title="No teams"
						description="Create a team to group developers for manager filters."
					/>
				</div>
			) : (
				<ul className="rounded-[var(--radius-card)] bg-secondary divide-y divide-border">
					{items.map((t) => (
						<li
							key={t.id}
							className="flex items-center justify-between px-4 py-3 text-sm hover:bg-background/50"
						>
							<EntityLabel name={t.name} avatarUrl={t.avatarUrl} />
							<span className="space-x-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setEditing(t)}
								>
									Edit
								</Button>
								<Button
									variant="destructive"
									size="sm"
									onClick={() =>
										void archiveTeam(t.id)
											.then(reload)
											.catch((e: Error) => setError(e.message))
									}
								>
									Archive
								</Button>
							</span>
						</li>
					))}
				</ul>
			)}

			<TeamDialog
				team={editing}
				open={editing !== null}
				onOpenChange={(o) => {
					if (!o) {
						setEditing(null);
					}
				}}
				onSubmit={async (draft: TeamDraft) => {
					if (!editing) {
						return;
					}
					await patchTeam(editing.id, {
						name: draft.name,
						avatarUrl: draft.avatarUrl.trim() || null,
					});
					await reload();
				}}
			/>
		</div>
	);
}
