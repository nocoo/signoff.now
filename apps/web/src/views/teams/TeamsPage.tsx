import { UsersRound } from "lucide-react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { EntityLabel } from "@/components/EntityAvatar";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
				<div className="flex max-w-md flex-col gap-2 sm:flex-row">
					<Input
						placeholder="Team name"
						value={vm.name}
						onChange={(e) => vm.setName(e.target.value)}
						onKeyDown={(e) => {
							// Enter and the button go through the same guarded path, so
							// a fast Enter-then-click cannot create the team twice.
							if (e.key === "Enter") {
								e.preventDefault();
								void vm.create();
							}
						}}
					/>
					<Button disabled={vm.busy} onClick={() => void vm.create()}>
						{vm.busy ? "Adding…" : "Add"}
					</Button>
				</div>
			</section>

			{vm.loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : vm.items.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={UsersRound}
						title="No teams"
						description="Create a team to group developers for manager filters."
					/>
				</div>
			) : (
				<ul className="rounded-[var(--radius-card)] bg-secondary divide-y divide-border">
					{vm.items.map((t) => (
						<li
							key={t.id}
							className="flex items-center justify-between px-4 py-3 text-sm hover:bg-background/50"
						>
							<span className="flex min-w-0 items-center gap-2">
								<EntityLabel name={t.name} avatarUrl={t.avatarUrl} />
								{t.tagIds.map((id) => {
									const g = vm.tags.find((x) => x.id === id);
									return g ? (
										<span
											key={id}
											className="rounded-full px-2 py-0.5 text-xs text-white"
											style={{ backgroundColor: g.color }}
										>
											{g.name}
										</span>
									) : null;
								})}
							</span>
							<span className="space-x-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => vm.setEditing(t)}
								>
									Edit
								</Button>
								<Button
									variant="destructive"
									size="sm"
									disabled={vm.busy}
									onClick={() => void vm.archive(t.id)}
								>
									Archive
								</Button>
							</span>
						</li>
					))}
				</ul>
			)}

			<TeamDialog
				team={vm.editing}
				tags={vm.tags}
				open={vm.editing !== null}
				onOpenChange={(o) => {
					if (!o) {
						vm.setEditing(null);
					}
				}}
				onSubmit={vm.submitEdit}
				onCreateTag={vm.addTag}
			/>
		</div>
	);
}
