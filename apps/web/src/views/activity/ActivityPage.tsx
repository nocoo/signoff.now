import { EntityLabel } from "@/components/EntityAvatar";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { heatmapColor } from "@/lib/palette";
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

			<div className="grid gap-(--control-gap-x) sm:grid-cols-4">
				<Field label="Developer ids" className="sm:col-span-2">
					{(id) => (
						<Input
							id={id}
							value={vm.devs}
							onChange={(e) => vm.setDevs(e.target.value)}
							placeholder="id1,id2"
						/>
					)}
				</Field>
				<Field label="From">
					{(id) => (
						<Input
							id={id}
							type="date"
							value={vm.from}
							onChange={(e) => vm.setFrom(e.target.value)}
						/>
					)}
				</Field>
				<Field label="To">
					{(id) => (
						<Input
							id={id}
							type="date"
							value={vm.to}
							onChange={(e) => vm.setTo(e.target.value)}
						/>
					)}
				</Field>
			</div>

			<Button disabled={vm.loading} onClick={() => void vm.load()}>
				{vm.loading ? "Loading…" : "Load heatmap"}
			</Button>

			{vm.rosterError ? (
				<p className="text-sm text-muted-foreground" role="status">
					Names unavailable ({vm.rosterError}); showing ids.{" "}
					<button
						type="button"
						className="underline"
						onClick={() => void vm.reloadRoster()}
					>
						Retry
					</button>
				</p>
			) : null}

			{vm.error ? (
				<p className="text-sm text-destructive" role="alert">
					{vm.error}
				</p>
			) : null}

			{vm.comparison.length > 1 ? (
				<div className="rounded-md border border-border p-3">
					<p className="mb-2 text-sm font-medium">Developer totals</p>
					<ul className="flex flex-wrap gap-3 text-sm">
						{vm.comparison.map((c) => {
							const who = vm.describe(c.developerId);
							return (
								<li
									key={c.developerId}
									className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5"
								>
									<EntityLabel
										name={who.name}
										avatarUrl={who.avatarUrl}
										size="sm"
									/>
									<span className="font-medium">{c.total}</span>
								</li>
							);
						})}
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
									<td className="px-3 py-2">
										<EntityLabel
											name={vm.describe(r.developerId).name}
											avatarUrl={vm.describe(r.developerId).avatarUrl}
											size="sm"
										/>
									</td>
									<td className="px-3 py-2">{r.dayKey}</td>
									<td className="px-3 py-2">{r.total}</td>
									<td className="px-3 py-2">{r.activityCount}</td>
									<td className="px-3 py-2">
										<span
											className="inline-block h-4 w-4 rounded-sm"
											style={{ background: heatmapColor(r.level) }}
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
				<div className="flex flex-wrap items-end gap-(--control-gap-x)">
					<Field label="Developer id" className="min-w-[16rem] flex-1">
						{(id) => (
							<Input
								id={id}
								className="font-mono"
								value={vm.timelineDev}
								onChange={(e) => vm.setTimelineDev(e.target.value)}
								placeholder="single developer id"
							/>
						)}
					</Field>
					<Button
						variant="outline"
						disabled={vm.timelineLoading}
						onClick={() => void vm.loadTimeline()}
					>
						{vm.timelineLoading ? "Loading…" : "Load timeline"}
					</Button>
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
					<Button
						variant="outline"
						disabled={vm.timelineLoading}
						onClick={() => void vm.loadTimeline({ more: true })}
					>
						Load more
					</Button>
				) : null}
			</section>
		</div>
	);
}
