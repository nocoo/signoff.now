import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

	const reload = useCallback(async () => {
		try {
			setItems(await listDevelopers());
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Load failed");
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
			{error ? <p className="text-sm text-destructive">{error}</p> : null}

			<section className="space-y-3 rounded-md border border-border p-4">
				<h2 className="font-display text-base font-semibold">Add developer</h2>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-1">
						<Label htmlFor="dev-name">Name</Label>
						<Input
							id="dev-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="space-y-1">
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
					Create
				</Button>
			</section>

			<div className="overflow-x-auto rounded-md border border-border">
				<table className="w-full text-sm">
					<thead className="bg-secondary/60 text-left">
						<tr>
							<th className="px-3 py-2">Name</th>
							<th className="px-3 py-2">Alias</th>
							<th className="px-3 py-2" />
						</tr>
					</thead>
					<tbody>
						{items.map((d) => (
							<tr key={d.id} className="border-t border-border">
								<td className="px-3 py-2">{d.name}</td>
								<td className="px-3 py-2 font-mono text-xs">{d.alias}</td>
								<td className="px-3 py-2 text-right">
									<Button
										variant="outline"
										size="sm"
										className="mr-2"
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
						{items.length === 0 ? (
							<tr>
								<td
									colSpan={3}
									className="px-3 py-6 text-center text-muted-foreground"
								>
									No developers yet
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}
