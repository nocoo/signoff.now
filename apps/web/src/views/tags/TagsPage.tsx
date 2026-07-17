import { Tag as TagIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tag } from "@/models/entities";
import { archiveTag, createTag, listTags } from "@/models/entitiesApi";

export function TagsPage() {
	const [items, setItems] = useState<Tag[]>([]);
	const [name, setName] = useState("");
	const [color, setColor] = useState("#00A4EF");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const reload = useCallback(async () => {
		try {
			setItems(await listTags());
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
				title="Tags"
				description="Color labels for developers (filtering and comparison)."
			/>
			{error ? <AlertBanner variant="error">{error}</AlertBanner> : null}

			<section className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
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
						aria-label="Tag color"
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
			</section>

			{loading ? (
				<div className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2">
					<Skeleton className="h-10 w-full" />
				</div>
			) : items.length === 0 ? (
				<div className="rounded-[var(--radius-card)] bg-secondary">
					<EmptyState
						icon={TagIcon}
						title="No tags"
						description="Add named color tags to classify developers."
					/>
				</div>
			) : (
				<ul className="rounded-[var(--radius-card)] bg-secondary divide-y divide-border">
					{items.map((t) => (
						<li
							key={t.id}
							className="flex items-center justify-between px-4 py-3 text-sm hover:bg-background/50"
						>
							<span className="flex items-center gap-2 font-medium">
								<span
									className="inline-block h-3 w-3 rounded-full ring-1 ring-border"
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
				</ul>
			)}
		</div>
	);
}
