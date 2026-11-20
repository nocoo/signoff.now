import { cn } from "@/lib/utils";

export interface TimelineItem {
	id: string;
	at: string;
	title: string;
}

export interface TimelineProps {
	items: readonly TimelineItem[];
	ariaLabel: string;
	className?: string;
}

export function Timeline({ items, ariaLabel, className }: TimelineProps) {
	return (
		<ol aria-label={ariaLabel} className={cn("space-y-3 text-sm", className)}>
			{items.map((item) => (
				<li
					key={item.id}
					className="flex items-baseline gap-3 border-b border-basalt-border/60 pb-2 last:border-b-0 last:pb-0"
				>
					<span className="shrink-0 font-mono text-xs text-basalt-muted-foreground tabular-nums">
						{item.at}
					</span>
					<span className="min-w-0 flex-1 text-basalt-foreground">
						{item.title}
					</span>
				</li>
			))}
		</ol>
	);
}
