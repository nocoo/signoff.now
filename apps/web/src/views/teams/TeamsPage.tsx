import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Team } from "@/models/entities";
import { archiveTeam, createTeam, listTeams } from "@/models/entitiesApi";

export function TeamsPage() {
	const [items, setItems] = useState<Team[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setItems(await listTeams());
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
			<div className="flex max-w-md gap-2">
				<Input
					placeholder="Team name"
					value={name}
					onChange={(e) => setName(e.target.value)}
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
			<ul className="divide-y divide-border rounded-md border border-border">
				{items.map((t) => (
					<li
						key={t.id}
						className="flex items-center justify-between px-3 py-2 text-sm"
					>
						<span>{t.name}</span>
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
					</li>
				))}
				{items.length === 0 ? (
					<li className="px-3 py-6 text-center text-sm text-muted-foreground">
						No teams
					</li>
				) : null}
			</ul>
		</div>
	);
}
