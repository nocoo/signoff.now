/**
 * BarChart — simple CSS-based horizontal/vertical bar chart.
 * No chart library — just divs with dynamic widths/heights.
 *
 * Supports:
 * - Single color (barColor string)
 * - Multi-color palette (colors cycle per bar)
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { cn } from "@signoff/ui/utils";

/** 8-hue palette for multi-color charts. */
const PALETTE = [
	"bg-blue-500/70",
	"bg-emerald-500/70",
	"bg-amber-500/70",
	"bg-violet-500/70",
	"bg-rose-500/70",
	"bg-cyan-500/70",
	"bg-orange-500/70",
	"bg-teal-500/70",
];

interface BarChartItem {
	label: string;
	value: number;
}

interface BarChartProps {
	items: BarChartItem[];
	direction?: "horizontal" | "vertical";
	maxItems?: number;
	className?: string;
	/** Single color class for all bars. Ignored when `colorful` is true. */
	barColor?: string;
	/** Use cycling palette colors instead of a single barColor. */
	colorful?: boolean;
}

function barColorAt(
	index: number,
	colorful: boolean,
	barColor: string,
): string {
	return colorful ? PALETTE[index % PALETTE.length] : barColor;
}

export function BarChart({
	items,
	direction = "horizontal",
	maxItems = 10,
	className,
	barColor = "bg-primary/60",
	colorful = false,
}: BarChartProps) {
	const visible = items.slice(0, maxItems);
	const maxValue = Math.max(...visible.map((i) => i.value), 1);

	if (direction === "vertical") {
		return (
			<div className={cn("flex items-end gap-1", className)}>
				{visible.map((item, i) => (
					<Tooltip key={`${item.label}-${i}`}>
						<TooltipTrigger asChild>
							<div className="flex flex-1 flex-col items-center gap-1">
								<div
									className={cn(
										"w-full min-h-1 rounded-t",
										barColorAt(i, colorful, barColor),
									)}
									style={{
										height: `${(item.value / maxValue) * 100}%`,
										minHeight: item.value > 0 ? "4px" : "1px",
									}}
								/>
								<span className="text-[10px] text-muted-foreground leading-none">
									{item.label}
								</span>
							</div>
						</TooltipTrigger>
						<TooltipContent>
							{item.label}: {item.value}
						</TooltipContent>
					</Tooltip>
				))}
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			{visible.map((item, i) => (
				<div key={`${item.label}-${i}`} className="flex items-center gap-2">
					<span className="w-24 shrink-0 truncate text-sm text-muted-foreground">
						{item.label}
					</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="relative h-5 flex-1 rounded bg-muted/50">
								<div
									className={cn(
										"h-full rounded",
										barColorAt(i, colorful, barColor),
									)}
									style={{
										width: `${(item.value / maxValue) * 100}%`,
										minWidth: item.value > 0 ? "4px" : "0px",
									}}
								/>
							</div>
						</TooltipTrigger>
						<TooltipContent>
							{item.label}: {item.value}
						</TooltipContent>
					</Tooltip>
					<span className="w-10 shrink-0 text-right text-sm tabular-nums">
						{item.value}
					</span>
				</div>
			))}
		</div>
	);
}
