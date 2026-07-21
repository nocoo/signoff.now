import { GitBranch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Repo } from "@/models/entities";
import {
	archiveRepo,
	createRepo,
	listRepos,
	patchRepo,
} from "@/models/entitiesApi";

export function ReposPage() {
	const [items, setItems] = useState<Repo[]>([]);
	const [org, setOrg] = useState("");
	const [project, setProject] = useState("");
	const [name, setName] = useState("");
	const [externalId, setExternalId] = useState("");
	const [projectExternalId, setProjectExternalId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	/** Inline edit drafts for project GUID backfill (repo id → draft). */
	const [guidDrafts, setGuidDrafts] = useState<Record<string, string>>({});

	const reload = useCallback(async () => {
		try {
			const list = await listRepos();
			setItems(list);
			const drafts: Record<string, string> = {};
			for (const r of list) {
				drafts[r.id] = r.projectExternalId ?? "";
			}
			setGuidDrafts(drafts);
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
				title="Repos"
				description="Azure DevOps repository bindings for local pipeline collection."
			/>
			{error ? <AlertBanner variant="error">{error}</AlertBanner> : null}

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-4">
				<h2 className="font-display text-base font-semibold">Bind repo</h2>
				<div className="grid max-w-2xl gap-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label>Org</Label>
						<Input value={org} onChange={(e) => setOrg(e.target.value)} />
					</div>
					<div className="space-y-1.5">
						<Label>Project</Label>
						<Input
							value={project}
							onChange={(e) => setProject(e.target.value)}
						/>
					</div>
					<div className="space-y-1.5">
						<Label>Repo name</Label>
						<Input value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="space-y-1.5">
						<Label>ADO repository GUID</Label>
						<Input
							value={externalId}
							onChange={(e) => setExternalId(e.target.value)}
							placeholder="xxxxxxxx-xxxx-…"
						/>
					</div>
					<div className="space-y-1.5 sm:col-span-2">
						<Label>ADO project GUID (optional)</Label>
						<Input
							value={projectExternalId}
							onChange={(e) => setProjectExternalId(e.target.value)}
							placeholder="Project GUID for WI external_ref — same project must match"
						/>
					</div>
				</div>
				<Button
					onClick={() =>
						void createRepo({
							org,
							project,
							name,
							externalId,
							projectExternalId: projectExternalId.trim() || null,
							provider: "ado",
							enabled: true,
						})
							.then(() => {
								setOrg("");
								setProject("");
								setName("");
								setExternalId("");
								setProjectExternalId("");
								return reload();
							})
							.catch((e: Error) => setError(e.message))
					}
				>
					Add repo
				</Button>
			</section>

			{loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : items.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={GitBranch}
						title="No repos bound"
						description="Bind an ADO repository (org / project / name / GUIDs) so the local pipeline can collect."
					/>
				</div>
			) : (
				<div className="overflow-x-auto rounded-[var(--radius-card)] bg-secondary">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Org / Project
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Name
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Repo GUID
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Project GUID
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{items.map((r) => {
								const draft = guidDrafts[r.id] ?? "";
								const saved = r.projectExternalId ?? "";
								const dirty = draft.trim() !== saved;
								return (
									<tr
										key={r.id}
										className="border-b border-border last:border-0 hover:bg-background/50"
									>
										<td className="px-4 py-3">
											{r.org} / {r.project}
										</td>
										<td className="px-4 py-3 font-medium">{r.name}</td>
										<td className="px-4 py-3 font-mono text-xs text-muted-foreground">
											{r.externalId ?? "—"}
										</td>
										<td className="px-4 py-3">
											<div className="flex min-w-[14rem] items-center gap-2">
												<Input
													className="font-mono text-xs h-8"
													value={draft}
													onChange={(e) =>
														setGuidDrafts((d) => ({
															...d,
															[r.id]: e.target.value,
														}))
													}
													placeholder="Backfill project GUID"
												/>
												<Button
													size="sm"
													variant="secondary"
													disabled={!dirty}
													onClick={() =>
														void patchRepo(r.id, {
															projectExternalId: draft.trim() || null,
															// keep externalId so ADO enabled check still holds
															externalId: r.externalId,
														})
															.then(reload)
															.catch((e: Error) => setError(e.message))
													}
												>
													Save
												</Button>
											</div>
										</td>
										<td className="px-4 py-3 text-right">
											<Button
												variant="destructive"
												size="sm"
												onClick={() =>
													void archiveRepo(r.id)
														.then(reload)
														.catch((e: Error) => setError(e.message))
												}
											>
												Archive
											</Button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
