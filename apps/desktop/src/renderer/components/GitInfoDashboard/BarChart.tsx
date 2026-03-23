/**
 * BarChart — simple CSS-based horizontal/vertical bar chart.
 * No chart library — just divs with dynamic widths/heights.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@signoff/ui/tooltip";
import { cn } from "@signoff/ui/utils";

interface BarChartItem {
	label: string;
	value: number;
}

interface BarChartProps {
	items: BarChartItem[];
	direction?: "horizontal" | "vertical";
	maxItems?: number;
	className?: string;
	barColor?: string;
}

export function BarChart({
	items,
	direction = "horizontal",
	maxItems = 10,
	className,
	barColor = "bg-primary/60",
}: BarChartProps) {
	const visible = items.slice(0, maxItems);
	const maxValue = Math.max(...visible.map((i) => i.value), 1);

	if (direction === "vertical") {
		return (
			<div className={cn("flex items-end gap-1", className)}>
				{visible.map((item) => (
					<Tooltip key={item.label}>
						<TooltipTrigger asChild>
							<div className="flex flex-1 flex-col items-center gap-1">
								<div
									className={cn("w-full min-h-1 rounded-t", barColor)}
									style={{
										height: `${(item.value / maxValue) * 100}%`,
										minHeight: item.value > 0 ? "4px" : "1px",
									}}
								/>
								<span className="text-[9px] text-muted-foreground leading-none">
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
			{visible.map((item) => (
				<div key={item.label} className="flex items-center gap-2">
					<span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
						{item.label}
					</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="relative h-4 flex-1 rounded bg-muted/50">
								<div
									className={cn("h-full rounded", barColor)}
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
					<span className="w-8 shrink-0 text-right text-xs tabular-nums">
						{item.value}
					</span>
				</div>
			))}
		</div>
	);
}
