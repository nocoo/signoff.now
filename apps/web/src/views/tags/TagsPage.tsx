import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tag } from "@/models/entities";
import { archiveTag, createTag, listTags } from "@/models/entitiesApi";

export function TagsPage() {
	const [items, setItems] = useState<Tag[]>([]);
	const [name, setName] = useState("");
	const [color, setColor] = useState("#3B82F6");
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setItems(await listTags());
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
			<div className="flex max-w-lg flex-wrap gap-2">
				<Input
					placeholder="Tag name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="w-40"
				/>
				<Input
					type="color"
					value={color}
					onChange={(e) => setColor(e.target.value)}
					className="w-14 p-1"
				/>
				<Button
					onClick={() =>
						void createTag(name, color)
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
						<span className="flex items-center gap-2">
							<span
								className="inline-block h-3 w-3 rounded-full"
								style={{ background: t.color }}
							/>
							{t.name}
						</span>
						<Button
							variant="destructive"
							size="sm"
							onClick={() =>
								void archiveTag(t.id)
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
						No tags
					</li>
				) : null}
			</ul>
		</div>
	);
}
