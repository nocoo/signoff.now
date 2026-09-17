import {
	Badge,
	Button,
	DescriptionList,
	Field,
	Input,
	LayerCard,
} from "@nocoo/basalt";
import { Timeline } from "@nocoo/basalt/charts/timeline";
import { DatePicker } from "@nocoo/basalt/components/date-picker";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { AlertBanner } from "@/components/AlertBanner";
import { EntityLabel } from "@/components/EntityAvatar";
import { heatmapColor } from "@/lib/palette";
import { useActivityHeatmapViewModel } from "@/viewmodels/useActivityHeatmapViewModel";

export function ActivityPage() {
	const vm = useActivityHeatmapViewModel();
	const scoresStale = vm.data?.scoresStale || vm.timeline?.scoresStale;

	return (
		<div className="space-y-6">
			<PageHeader
				title="Activity"
				description="Explore contribution heatmaps and scores across developers and repositories."
				actions={
					<Button disabled={vm.loading} onClick={() => void vm.load()}>
						{vm.loading ? "Loading…" : "Load heatmap"}
					</Button>
				}
			/>

			{scoresStale ? (
				<AlertBanner variant="warning">
					Scores are stale
					{vm.data?.staleReason || vm.timeline?.staleReason
						? `: ${vm.data?.staleReason ?? vm.timeline?.staleReason}`
						: ""}
					. Re-run full_rematch ingest and recompute complete before trusting
					totals.
				</AlertBanner>
			) : null}

			<LayerCard
				role="search"
				aria-label="Activity filters"
				className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
			>
				<Field label="Developer ids" className="sm:col-span-2">
					<Input
						value={vm.devs}
						onChange={(e) => vm.setDevs(e.target.value)}
						placeholder="id1,id2"
					/>
				</Field>
				<Field label="From">
					<DatePicker value={vm.from} onChange={vm.setFrom} />
				</Field>
				<Field label="To">
					<DatePicker value={vm.to} onChange={vm.setTo} />
				</Field>
			</LayerCard>

			{vm.rosterError ? (
				<AlertBanner>
					Names unavailable ({vm.rosterError}); showing ids.{" "}
					<Button
						type="button"
						variant="link"
						className="h-auto p-0"
						onClick={() => void vm.reloadRoster()}
					>
						Retry
					</Button>
				</AlertBanner>
			) : null}

			{vm.error ? (
				<p className="text-sm text-basalt-destructive" role="alert">
					{vm.error}
				</p>
			) : null}

			{!scoresStale && vm.comparison.length > 1 ? (
				<LayerCard padding="none">
					<LayerCard.Header>
						<h2 className="text-sm font-medium">Developer totals</h2>
					</LayerCard.Header>
					<LayerCard.Well>
						<DescriptionList columns={3}>
							{vm.comparison.map((c) => {
								const who = vm.describe(c.developerId);
								return (
									<DescriptionList.Item
										key={c.developerId}
										term={
											<EntityLabel
												name={who.name}
												avatarUrl={who.avatarUrl}
												size="sm"
											/>
										}
									>
										{c.total}
									</DescriptionList.Item>
								);
							})}
						</DescriptionList>
					</LayerCard.Well>
				</LayerCard>
			) : null}

			{!scoresStale && vm.levels.length > 0 ? (
				<LayerCard padding="none" className="overflow-x-auto">
					<Table aria-label="Daily developer scores">
						<TableHeader>
							<TableRow>
								<TableHead>Developer</TableHead>
								<TableHead>Day</TableHead>
								<TableHead>Total</TableHead>
								<TableHead>Count</TableHead>
								<TableHead>Heat</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{vm.levels.map((r) => (
								<TableRow key={`${r.developerId}-${r.dayKey}`}>
									<TableCell>
										<EntityLabel
											name={vm.describe(r.developerId).name}
											avatarUrl={vm.describe(r.developerId).avatarUrl}
											size="sm"
										/>
									</TableCell>
									<TableCell>{r.dayKey}</TableCell>
									<TableCell>{r.total}</TableCell>
									<TableCell>{r.activityCount}</TableCell>
									<TableCell>
										<Badge
											variant={null}
											className="h-4 w-4 rounded-basalt-sm p-0"
											style={{ background: heatmapColor(r.level) }}
											title={`level ${r.level}`}
											role="img"
											aria-label={`Heat level ${r.level}`}
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</LayerCard>
			) : vm.data && !scoresStale ? (
				<p className="text-sm text-basalt-muted-foreground">
					No scores in range.
				</p>
			) : null}

			<SectionRule title="Timeline">
				<div className="space-y-3">
					<p className="text-sm text-basalt-muted-foreground">
						Single-developer activity list (settings timezone day keys). Uses
						the same date range as heatmap.
					</p>
					<LayerCard
						role="search"
						aria-label="Timeline filters"
						className="flex flex-wrap items-end gap-3"
					>
						<Field label="Developer id" className="min-w-0 flex-1 basis-64">
							<Input
								className="font-mono"
								value={vm.timelineDev}
								onChange={(e) => vm.setTimelineDev(e.target.value)}
								placeholder="single developer id"
							/>
						</Field>
						<Button
							variant="outline"
							disabled={vm.timelineLoading}
							onClick={() => void vm.loadTimeline()}
						>
							{vm.timelineLoading ? "Loading…" : "Load timeline"}
						</Button>
					</LayerCard>

					{vm.timelineError ? (
						<p className="text-sm text-basalt-destructive" role="alert">
							{vm.timelineError}
						</p>
					) : null}

					{!scoresStale && vm.timelineItems.length > 0 ? (
						<LayerCard>
							<Timeline
								ariaLabel="Developer activity timeline"
								className="[&>li]:flex-col [&>li]:break-words sm:[&>li]:flex-row"
								items={vm.timelineItems.map((item) => ({
									id: item.id,
									at: `${item.dayKey} · ${item.occurredAt}`,
									title: `${item.type} · ${item.org} / ${item.project}${item.repoId ? ` · ${item.repoId}` : ""}`,
								}))}
							/>
						</LayerCard>
					) : vm.timeline && !scoresStale ? (
						<p className="text-sm text-basalt-muted-foreground">
							No activities in range.
						</p>
					) : null}

					{!scoresStale && vm.timeline?.nextCursor ? (
						<Button
							variant="outline"
							disabled={vm.timelineLoading}
							onClick={() => void vm.loadTimeline({ more: true })}
						>
							Load more
						</Button>
					) : null}
				</div>
			</SectionRule>
		</div>
	);
}
