import { PageHeader } from "@/components/PageHeader";
import { useActivityHeatmapViewModel } from "@/viewmodels/useActivityHeatmapViewModel";

export function ActivityPage() {
	const vm = useActivityHeatmapViewModel();

	return (
		<div className="space-y-6">
			<PageHeader
				title="Activity"
				description="Read-only heatmaps and scores — written exclusively by the local pipeline."
			/>

			{vm.data?.scoresStale ? (
				<div
					className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
					role="status"
				>
					Scores are stale
					{vm.data.staleReason ? `: ${vm.data.staleReason}` : ""}. Re-run
					full_rematch ingest and recompute complete before trusting totals.
				</div>
			) : null}

			<div className="grid gap-3 sm:grid-cols-4">
				<label className="text-sm sm:col-span-2">
					<span className="text-muted-foreground">Developer ids</span>
					<input
						className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
						value={vm.devs}
						onChange={(e) => vm.setDevs(e.target.value)}
						placeholder="id1,id2"
					/>
				</label>
				<label className="text-sm">
					<span className="text-muted-foreground">From</span>
					<input
						type="date"
						className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
						value={vm.from}
						onChange={(e) => vm.setFrom(e.target.value)}
					/>
				</label>
				<label className="text-sm">
					<span className="text-muted-foreground">To</span>
					<input
						type="date"
						className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
						value={vm.to}
						onChange={(e) => vm.setTo(e.target.value)}
					/>
				</label>
			</div>

			<button
				type="button"
				className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
				disabled={vm.loading}
				onClick={() => void vm.load()}
			>
				{vm.loading ? "Loading…" : "Load heatmap"}
			</button>

			{vm.error ? (
				<p className="text-sm text-destructive" role="alert">
					{vm.error}
				</p>
			) : null}

			{vm.levels.length > 0 ? (
				<div className="overflow-x-auto rounded-md border border-border">
					<table className="w-full text-left text-sm">
						<thead className="border-b border-border bg-secondary/50">
							<tr>
								<th className="px-3 py-2 font-medium">Developer</th>
								<th className="px-3 py-2 font-medium">Day</th>
								<th className="px-3 py-2 font-medium">Total</th>
								<th className="px-3 py-2 font-medium">Count</th>
								<th className="px-3 py-2 font-medium">Heat</th>
							</tr>
						</thead>
						<tbody>
							{vm.levels.map((r) => (
								<tr
									key={`${r.developerId}-${r.dayKey}`}
									className="border-b border-border/60"
								>
									<td className="px-3 py-2 font-mono text-xs">
										{r.developerId}
									</td>
									<td className="px-3 py-2">{r.dayKey}</td>
									<td className="px-3 py-2">{r.total}</td>
									<td className="px-3 py-2">{r.activityCount}</td>
									<td className="px-3 py-2">
										<span
											className="inline-block h-4 w-4 rounded-sm"
											style={{
												background: `var(--heatmap-${r.level}, hsl(var(--muted)))`,
											}}
											title={`level ${r.level}`}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : vm.data && !vm.data.scoresStale ? (
				<p className="text-sm text-muted-foreground">No scores in range.</p>
			) : null}
		</div>
	);
}
