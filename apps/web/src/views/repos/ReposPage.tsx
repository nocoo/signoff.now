import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Repo } from "@/models/entities";
import { archiveRepo, createRepo, listRepos } from "@/models/entitiesApi";

export function ReposPage() {
	const [items, setItems] = useState<Repo[]>([]);
	const [org, setOrg] = useState("");
	const [project, setProject] = useState("");
	const [name, setName] = useState("");
	const [externalId, setExternalId] = useState("");
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setItems(await listRepos());
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Load failed");
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	return (
		<div className="space-y-6">
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
			<section className="grid max-w-2xl gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
				<div className="space-y-1">
					<Label>Org</Label>
					<Input value={org} onChange={(e) => setOrg(e.target.value)} />
				</div>
				<div className="space-y-1">
					<Label>Project</Label>
					<Input value={project} onChange={(e) => setProject(e.target.value)} />
				</div>
				<div className="space-y-1">
					<Label>Repo name</Label>
					<Input value={name} onChange={(e) => setName(e.target.value)} />
				</div>
				<div className="space-y-1">
					<Label>ADO repository GUID</Label>
					<Input
						value={externalId}
						onChange={(e) => setExternalId(e.target.value)}
						placeholder="xxxxxxxx-xxxx-…"
					/>
				</div>
				<div className="sm:col-span-2">
					<Button
						onClick={() =>
							void createRepo({
								org,
								project,
								name,
								externalId,
								provider: "ado",
								enabled: true,
							})
								.then(() => {
									setOrg("");
									setProject("");
									setName("");
									setExternalId("");
									return reload();
								})
								.catch((e: Error) => setError(e.message))
						}
					>
						Add repo
					</Button>
				</div>
			</section>

			<div className="overflow-x-auto rounded-md border border-border">
				<table className="w-full text-sm">
					<thead className="bg-secondary/60 text-left">
						<tr>
							<th className="px-3 py-2">Org / Project</th>
							<th className="px-3 py-2">Name</th>
							<th className="px-3 py-2">GUID</th>
							<th className="px-3 py-2" />
						</tr>
					</thead>
					<tbody>
						{items.map((r) => (
							<tr key={r.id} className="border-t border-border">
								<td className="px-3 py-2">
									{r.org} / {r.project}
								</td>
								<td className="px-3 py-2">{r.name}</td>
								<td className="px-3 py-2 font-mono text-xs">
									{r.externalId ?? "—"}
								</td>
								<td className="px-3 py-2 text-right">
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
						))}
						{items.length === 0 ? (
							<tr>
								<td
									colSpan={4}
									className="px-3 py-6 text-center text-muted-foreground"
								>
									No repos
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}
