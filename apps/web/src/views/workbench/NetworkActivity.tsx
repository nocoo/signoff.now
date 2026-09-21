import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { heatmapColor } from "@/lib/palette";
import { useNetworkActivity } from "@/viewmodels/useNetworkActivity";

const series = [
	{
		key: "adoDiscovery",
		name: "ADO discovery",
		label: "List",
		color: heatmapColor(2, "blue"),
	},
	{
		key: "adoDetails",
		name: "ADO PR details",
		label: "PR",
		color: heatmapColor(3, "blue"),
	},
	{
		key: "adoChecks",
		name: "ADO checks",
		label: "Checks",
		color: heatmapColor(4, "blue"),
	},
	{
		key: "jev",
		name: "Jev",
		label: "Jev",
		color: "hsl(var(--basalt-badge-purple))",
	},
] as const;
const time = (value: number) =>
	new Date(value * 1000).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

export function NetworkActivity() {
	const vm = useNetworkActivity();
	const buckets = vm.data?.buckets ?? [];
	const total = buckets.reduce(
		(sum, bucket) => sum + series.reduce((n, s) => n + bucket[s.key], 0),
		0,
	);
	return (
		<section
			aria-label="Provider network requests in the last hour"
			className="mx-2 border-b border-basalt-border pb-2 text-[11px]"
		>
			<div
				className="flex items-center justify-between gap-2 text-basalt-muted-foreground"
				title="Actual provider HTTP attempts, including retries and failures. One-minute buckets; current minute is partial. All projects. Updates every 10 seconds while visible. History starts when request tracking is enabled."
			>
				<span>Network · 1h</span>
				<span className="tabular-nums">
					{vm.data ? `${total} requests` : "—"}
				</span>
			</div>
			<div
				className="relative mt-1 h-16"
				role="img"
				aria-label={`${total} provider HTTP requests over the last hour. Blue: ADO; purple: Jev.`}
			>
				<ResponsiveContainer width="100%" height="100%" minWidth={0}>
					<BarChart
						data={buckets}
						barCategoryGap={1}
						margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
					>
						<XAxis dataKey="at" hide />
						<Tooltip
							allowEscapeViewBox={{ x: true, y: true }}
							wrapperStyle={{ zIndex: 50 }}
							labelFormatter={(value) => `${time(Number(value))} · requests`}
							contentStyle={{
								fontSize: 11,
								background: "hsl(var(--basalt-card))",
								borderColor: "hsl(var(--basalt-border))",
								borderRadius: 6,
							}}
							cursor={{ fill: "hsl(var(--basalt-muted))" }}
						/>
						{series.map((s) => (
							<Bar
								key={s.key}
								dataKey={s.key}
								name={s.name}
								fill={s.color}
								stackId="requests"
								isAnimationActive={false}
							/>
						))}
					</BarChart>
				</ResponsiveContainer>
				{!total && (
					<span className="pointer-events-none absolute inset-x-0 top-5 text-center text-basalt-muted-foreground">
						{vm.error
							? "Activity unavailable"
							: vm.loading
								? "Loading activity…"
								: "No recorded requests"}
					</span>
				)}
			</div>
			<div
				className="flex justify-between text-basalt-muted-foreground tabular-nums"
				aria-hidden="true"
			>
				{[0, 30, 59].map((i) => (
					<span key={i}>{buckets[i] ? time(buckets[i].at) : "—"}</span>
				))}
			</div>
			<div className="flex items-center justify-between gap-1 text-basalt-muted-foreground">
				{series.map((s) => (
					<span
						key={s.key}
						className="inline-flex items-center gap-1"
						title={s.name}
					>
						<span
							className="size-1.5 rounded-sm"
							style={{ background: s.color }}
						/>
						{s.label}
					</span>
				))}
			</div>
			{!!vm.error && !!vm.data && (
				<div className="text-basalt-destructive" title={vm.error}>
					Update delayed
				</div>
			)}
		</section>
	);
}
