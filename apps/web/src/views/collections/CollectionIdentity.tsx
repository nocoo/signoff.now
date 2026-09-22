import type { PrCollection } from "@signoff/domain/pr-collections";
import {
	BookOpen,
	Flag,
	FlaskConical,
	Layers3,
	Rocket,
	Target,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export const COLLECTION_ICONS = {
	layers: Layers3,
	flask: FlaskConical,
	target: Target,
	flag: Flag,
	rocket: Rocket,
	book: BookOpen,
};
export const COLLECTION_COLORS = {
	violet: "--basalt-badge-purple",
	blue: "--basalt-info",
	teal: "--basalt-badge-teal",
	amber: "--basalt-warning",
	rose: "--basalt-danger",
	slate: "--basalt-muted-foreground",
};
export function collectionStyle(color: PrCollection["color"]) {
	return {
		"--collection-color": `var(${COLLECTION_COLORS[color]})`,
	} as CSSProperties;
}
export function CollectionIcon({
	collection,
	compact = false,
}: {
	collection: Pick<PrCollection, "icon" | "color">;
	compact?: boolean;
}) {
	const Icon = COLLECTION_ICONS[collection.icon];
	return (
		<span
			style={collectionStyle(collection.color)}
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-basalt-md bg-[hsl(var(--collection-color)/0.12)] text-[hsl(var(--collection-color))]",
				compact ? "size-7" : "size-11",
			)}
		>
			<Icon aria-hidden className={compact ? "size-4" : "size-5"} />
		</span>
	);
}
export function CollectionProgress({
	collection,
}: {
	collection: PrCollection;
}) {
	const { total, open, draft, merged, closed } = collection.counts;
	const percent = total ? Math.round((merged / total) * 100) : 0;
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2 text-xs">
				<span className="text-basalt-muted-foreground">Merged progress</span>
				<span className="font-medium tabular-nums">
					{merged} / {total}
					<span className="ml-2 text-basalt-muted-foreground">{percent}%</span>
				</span>
			</div>
			<div
				className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-basalt-muted"
				role="img"
				aria-label={`${merged} merged, ${open} open, ${draft} draft, ${closed} closed out of ${total}`}
			>
				{[
					[merged, "bg-basalt-badge-purple"],
					[open, "bg-basalt-info"],
					[draft, "bg-basalt-muted-foreground/40"],
					[closed, "bg-basalt-danger/60"],
				].map(([n, color]) =>
					Number(n) > 0 ? (
						<span
							key={String(color)}
							className={String(color)}
							style={{ width: `${(Number(n) / total) * 100}%` }}
						/>
					) : null,
				)}
			</div>
		</div>
	);
}
