import {
	ANIMATION_PROPS,
	BAR_RADIUS,
	CHART_PLOT_MARGIN,
	ChartFrame,
	ChartLegend,
	type ChartSeriesDescriptor,
	ChartTooltipContent,
	cartesianAxisProps,
	GRID_PROPS,
	getChartColor,
	resolveChartSeries,
} from "@nocoo/basalt/components/chart";
import {
	Bar,
	CartesianGrid,
	BarChart as RechartsBarChart,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

export type BarChartDatum = Record<string, string | number | undefined>;

export interface BarChartProps {
	ariaLabel: string;
	data: readonly BarChartDatum[];
	series?: ChartSeriesDescriptor[];
	className?: string;
	showAxes?: boolean;
	showLegend?: boolean;
	xValueFormatter?: (value: string | number) => string;
	summary?: string;
}

export function BarChart({
	ariaLabel,
	data,
	series,
	className,
	showAxes = false,
	showLegend = false,
	xValueFormatter,
	summary,
}: BarChartProps) {
	const resolved = resolveChartSeries(series, ["y"]);
	const legendItems = resolved.map((item, index) => ({
		...item,
		color: item.color ?? getChartColor(index),
	}));

	return (
		<div className="space-y-2">
			<ChartFrame
				ariaLabel={ariaLabel}
				size={className}
				summary={summary}
				legend={
					showLegend ? (
						<ChartLegend items={legendItems} shape="bar" />
					) : undefined
				}
			>
				<RechartsBarChart data={[...data]} margin={CHART_PLOT_MARGIN}>
					{showAxes ? <CartesianGrid {...GRID_PROPS} /> : null}
					<XAxis
						dataKey="x"
						{...cartesianAxisProps(!showAxes)}
						tickFormatter={xValueFormatter}
					/>
					<YAxis {...cartesianAxisProps(!showAxes)} allowDecimals={false} />
					<Tooltip
						content={<ChartTooltipContent />}
						cursor={{ fill: "hsl(var(--basalt-muted) / 0.4)" }}
					/>
					{legendItems.map((item) => (
						<Bar
							key={item.key}
							dataKey={item.key}
							name={item.label ?? item.key}
							fill={item.color}
							radius={BAR_RADIUS.vertical}
							{...ANIMATION_PROPS}
						/>
					))}
				</RechartsBarChart>
			</ChartFrame>
		</div>
	);
}
