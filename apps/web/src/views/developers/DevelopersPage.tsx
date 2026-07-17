import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Developer } from "@/models/entities";
import { validateDeveloperInput } from "@/models/entities";
import {
	archiveDeveloper,
	createDeveloper,
	listDevelopers,
	patchDeveloper,
} from "@/models/entitiesApi";

export function DevelopersPage() {
	const [items, setItems] = useState<Developer[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [alias, setAlias] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);

	const reload = useCallback(async () => {
		try {
			setItems(await listDevelopers());
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

			{loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-2/3" />
				</div>
			) : items.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={Users}
						title="No developers yet"
						description="Add a display name and alias. Matching uses alias@suffix from Settings."
					/>
				</div>
			) : (
				<div className="overflow-x-auto rounded-[var(--radius-card)] bg-secondary">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Name
								</th>
								<th className="px-4 py-3 text-xs font-medium text-muted-foreground">
									Alias
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{items.map((d) => (
								<tr
									key={d.id}
									className="border-b border-border last:border-0 hover:bg-background/50"
								>
									<td className="px-4 py-3 font-medium">{d.name}</td>
									<td className="px-4 py-3 font-mono text-xs text-muted-foreground">
										{d.alias}
									</td>
									<td className="px-4 py-3 text-right space-x-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const n = window.prompt("Name", d.name);
												const a = window.prompt("Alias", d.alias);
												if (n === null || a === null) {
													return;
												}
												void patchDeveloper(d.id, { name: n, alias: a })
													.then(reload)
													.catch((e: Error) => setError(e.message));
											}}
										>
											Edit
										</Button>
										<Button
											variant="destructive"
											size="sm"
											onClick={() =>
												void archiveDeveloper(d.id)
													.then(reload)
													.catch((e: Error) => setError(e.message))
											}
										>
											Archive
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
