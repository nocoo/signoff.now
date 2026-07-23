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

			{vm.data?.scoresStale || vm.timeline?.scoresStale ? (
				<div
					className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
					role="status"
				>
					Scores are stale
					{vm.data?.staleReason || vm.timeline?.staleReason
						? `: ${vm.data?.staleReason ?? vm.timeline?.staleReason}`
						: ""}
					. Re-run full_rematch ingest and recompute complete before trusting
					totals.
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

			{vm.comparison.length > 1 ? (
				<div className="rounded-md border border-border p-3">
					<p className="mb-2 text-sm font-medium">Developer totals</p>
					<ul className="flex flex-wrap gap-3 text-sm">
						{vm.comparison.map((c) => (
							<li
								key={c.developerId}
								className="rounded-md bg-secondary px-3 py-1.5 font-mono text-xs"
							>
								{c.developerId}:{" "}
								<span className="font-sans font-medium">{c.total}</span>
							</li>
						))}
					</ul>
				</div>
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

			<section className="space-y-3 border-t border-border pt-6">
				<h2 className="text-base font-medium">Timeline</h2>
				<p className="text-sm text-muted-foreground">
					Single-developer activity list (settings timezone day keys). Uses the
					same date range as heatmap.
				</p>
				<div className="flex flex-wrap items-end gap-3">
					<label className="text-sm min-w-[16rem] flex-1">
						<span className="text-muted-foreground">Developer id</span>
						<input
							className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
							value={vm.timelineDev}
							onChange={(e) => vm.setTimelineDev(e.target.value)}
							placeholder="single developer id"
						/>
					</label>
					<button
						type="button"
						className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium disabled:opacity-50"
						disabled={vm.timelineLoading}
						onClick={() => void vm.loadTimeline()}
					>
						{vm.timelineLoading ? "Loading…" : "Load timeline"}
					</button>
				</div>

				{vm.timelineError ? (
					<p className="text-sm text-destructive" role="alert">
						{vm.timelineError}
					</p>
				) : null}

				{vm.timelineItems.length > 0 ? (
					<ul className="divide-y divide-border rounded-md border border-border">
						{vm.timelineItems.map((item) => (
							<li key={item.id} className="px-3 py-2 text-sm">
								<div className="flex flex-wrap items-baseline justify-between gap-2">
									<span className="font-medium">{item.type}</span>
									<span className="text-xs text-muted-foreground">
										{item.dayKey} · {item.occurredAt}
									</span>
								</div>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{item.org} / {item.project}
									{item.repoId ? ` · ${item.repoId}` : ""}
								</p>
							</li>
						))}
					</ul>
				) : vm.timeline && !vm.timeline.scoresStale ? (
					<p className="text-sm text-muted-foreground">
						No activities in range.
					</p>
				) : null}

				{vm.timeline?.nextCursor ? (
					<button
						type="button"
						className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm disabled:opacity-50"
						disabled={vm.timelineLoading}
						onClick={() => void vm.loadTimeline({ more: true })}
					>
						Load more
					</button>
				) : null}
			</section>
		</div>
	);
}
