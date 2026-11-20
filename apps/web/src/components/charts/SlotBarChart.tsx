import { cn } from "@/lib/utils";

export interface SlotBarChartItem {
	color: string;
	label: string;
}

export interface SlotBarChartProps {
	items: readonly SlotBarChartItem[];
	ariaLabel: string;
	heightClass?: string;
	gapClass?: string;
	className?: string;
}

export function SlotBarChart({
	items,
	ariaLabel,
	heightClass = "h-2",
	gapClass = "gap-0.5",
	className,
}: SlotBarChartProps) {
	if (items.length === 0) {
		return (
			<div
				role="img"
				aria-label={ariaLabel}
				className={cn(
					"w-full overflow-hidden rounded-full bg-basalt-muted",
					heightClass,
					className,
				)}
			/>
		);
	}

	return (
		<div
			role="img"
			aria-label={ariaLabel}
			className={cn(
				"flex w-full overflow-hidden rounded-full bg-basalt-muted",
				heightClass,
				gapClass,
				className,
			)}
		>
			{(() => {
				const counts = new Map<string, number>();
				return items.map((item) => {
					const n = (counts.get(item.label) ?? 0) + 1;
					counts.set(item.label, n);
					const isTailwindBg = item.color.startsWith("bg-");
					return (
						<div
							key={`${item.label}-${n}`}
							title={item.label}
							className={cn(
								"h-full flex-1",
								isTailwindBg ? item.color : undefined,
							)}
							style={isTailwindBg ? undefined : { backgroundColor: item.color }}
						/>
					);
				});
			})()}
		</div>
	);
}
