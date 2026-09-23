import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import type {
	ContributionReport,
	ContributorRepositoryContribution,
	PullCounts,
} from "@signoff/domain/insights";
import {
	ChevronLeft,
	ChevronRight,
	GitPullRequest,
	RefreshCw,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertBanner } from "@/components/AlertBanner";
import { ContributionFilterBar } from "@/components/ContributionFilterBar";
import { ContributorProfile } from "@/components/ContributorProfile";
import { EmptyState } from "@/components/EmptyState";
import { EntityLabel } from "@/components/EntityAvatar";
import { SelectControl } from "@/components/SelectControl";
import { Skeleton } from "@/components/Skeleton";
import { StatCard, StatGrid } from "@/components/StatCard";
import { relativeAge } from "@/models/freshness";
import { useContributionReport } from "@/viewmodels/useContributionReport";
import { useInsightsViewModel } from "@/viewmodels/useInsightsViewModel";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { useWorkbench } from "@/viewmodels/WorkbenchProvider";

const STATES = ["open", "merged", "closed", "draft"] as const;
const percent = (count: number, total: number) =>
	total ? `${((100 * count) / total).toFixed(1)}%` : "—";

export function InsightsPage() {
	const source = useWorkbench().filter.source;
	const vm = useInsightsViewModel(source);
	const [search, setSearch] = useSearchParams();
	const hasLink = ["contributor", "team", "tag"].some((key) => search.has(key));
	const { setFilters } = vm;
	useEffect(() => {
		if (!hasLink) return;
		const requestedSource = search.get("source");
		if (
			(requestedSource === "cli" || requestedSource === "demo") &&
			requestedSource !== source
		)
			return;
		setFilters({
			projectIds: [],
			repositoryKeys: [],
			audience: "all",
			contributorKeys: search.getAll("contributor").filter(Boolean),
			teamIds: search.getAll("team").filter(Boolean),
			tagIds: search.getAll("tag").filter(Boolean),
		});
		setSearch(
			(previous) => {
				const next = new URLSearchParams(previous);
				for (const key of ["contributor", "team", "tag"]) next.delete(key);
				return next;
			},
			{ replace: true },
		);
	}, [hasLink, search, setSearch, setFilters, source]);
	const state = useContributionReport(
		source,
		hasLink ? null : vm.validFilters,
		vm.directory,
	);
	const now = useMinuteNow();
	const report = state.report;
	return (
		<div className="space-y-4">
			<PageHeader
				title="Contributions"
				description="Explore contributions across repositories and compare followed people with every author."
				actions={
					<>
						<Button asChild variant="outline" size="sm">
							<Link to="/developers">
								<Users className="h-4 w-4" aria-hidden />
								Manage members
							</Link>
						</Button>
						<Button
							size="sm"
							disabled={
								!vm.validFilters ||
								!vm.directory ||
								state.calculating ||
								hasLink
							}
							onClick={() => void state.calculate()}
						>
							<RefreshCw
								className={`h-4 w-4 ${state.calculating ? "animate-spin motion-reduce:animate-none" : ""}`}
								aria-hidden
							/>
							{state.calculating ? "Calculating…" : "Calculate"}
						</Button>
					</>
				}
			/>
			<ContributionFilterBar vm={vm} withDates={false} />
			<div className="flex flex-wrap items-center gap-2 text-xs text-basalt-muted-foreground">
				<Badge variant="secondary">Last 90 days</Badge>
				<span>
					{vm.filters.from} – {vm.filters.to} · UTC · Created PRs
				</span>
				<span className="ml-auto">
					Newest collected record:{" "}
					{report?.totals.lastCollectedAt
						? relativeAge(report.totals.lastCollectedAt, now)
						: "none"}
				</span>
			</div>
			<p className="text-xs text-basalt-muted-foreground">
				{source === "demo"
					? "Sample history is separate from Live data. "
					: "Counts use discovered PRs in the local cache. "}
				Calculate discovers the complete 90-day window per repository and
				refreshes PR states. Counts may be incomplete until discovery finishes.
			</p>
			{state.progress ? (
				<AlertBanner>
					{state.progress} Check Connector in the sidebar for task details.
				</AlertBanner>
			) : null}
			{state.error ? (
				<AlertBanner variant="error">
					{state.error}{" "}
					<Button variant="link" size="sm" onClick={() => void state.reload()}>
						Reload cached report
					</Button>
				</AlertBanner>
			) : null}
			{report ? (
				<>
					<StatGrid columns={4}>
						<StatCard title="Selected PRs" value={report.totals.total} />
						<StatCard title="Merged" value={report.totals.merged} />
						<StatCard title="Contributors" value={report.totals.contributors} />
						<StatCard title="Repositories" value={report.totals.repositories} />
					</StatGrid>
					<ContributorReport
						key={`contributors:${JSON.stringify(report.filters)}`}
						report={report}
					/>
					<RepositoryReport
						key={`repositories:${JSON.stringify(report.filters)}`}
						report={report}
					/>
				</>
			) : state.loading ? (
				<div
					role="status"
					className="space-y-4"
					aria-label="Loading contribution reports"
				>
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-64 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			) : null}
		</div>
	);
}

function CountHeaders() {
	return (
		<>
			<TableHead className="text-right">Total</TableHead>
			{STATES.map((state) => (
				<TableHead key={state} className="text-right capitalize">
					{state}
				</TableHead>
			))}
		</>
	);
}
function CountCells({ counts }: { counts: PullCounts }) {
	return (
		<>
			<TableCell className="text-right font-semibold tabular-nums">
				{counts.total}
			</TableCell>
			{STATES.map((state) => (
				<TableCell key={state} className="text-right tabular-nums">
					{counts[state]}
				</TableCell>
			))}
		</>
	);
}
function Author({
	row,
}: {
	row:
		| ContributorRepositoryContribution
		| ContributionReport["members"][number];
}) {
	const source = useWorkbench().filter.source;
	return (
		<div className="flex items-center gap-2">
			{row.key.startsWith("unknown:") ? (
				<EntityLabel name={row.name} size="sm" />
			) : (
				<ContributorProfile
					source={source}
					contributorKey={row.key}
					name={row.name}
					avatarUrl={row.avatarUrl}
				/>
			)}
			{row.memberId ? <Badge variant="secondary">Followed</Badge> : null}
		</div>
	);
}

function ContributorReport({ report }: { report: ContributionReport }) {
	const [requested, select] = useState("");
	const member =
		report.members.find((row) => row.key === requested) ??
		report.members.find((row) => row.memberId !== null) ??
		report.members[0];
	const contributions = report.contributions.filter(
		(row) => row.key === member?.key && row.selected,
	);
	return (
		<LayerCard padding="none" aria-label="Contributor perspective">
			<LayerCard.Header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold">Contributor perspective</h2>
					<p className="mt-1 text-xs text-basalt-muted-foreground">
						One person's contributions across repositories, with their share and
						rank in each.
					</p>
				</div>
				{member ? (
					<SelectControl
						aria-label="Contributor"
						value={member.key}
						onChange={select}
						className="w-64 max-w-full"
					>
						{report.members.map((person) => (
							<option key={person.key} value={person.key}>
								{person.name}
								{person.memberId ? " · Followed" : ""} · {person.total} PRs
							</option>
						))}
					</SelectControl>
				) : null}
			</LayerCard.Header>
			<LayerCard.Well className="space-y-3">
				{member ? (
					<>
						<div className="flex flex-wrap items-center justify-between gap-3 text-xs">
							<Author row={member} />
							<span className="text-basalt-muted-foreground">
								{member.total} PRs · {contributions.length} repositories ·{" "}
								{percent(member.merged, member.total)} merged
							</span>
						</div>
						{contributions.length ? (
							<div className="overflow-x-auto">
								<Table
									aria-label="Contributor repository counts"
									className="min-w-[680px] text-xs"
								>
									<TableHeader>
										<TableRow>
											<TableHead>Repository</TableHead>
											<CountHeaders />
											<TableHead className="text-right">Repo share</TableHead>
											<TableHead className="text-right">Rank</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{contributions.map((row) => {
											const repo = report.repositories.find(
												(item) => item.key === row.repositoryKey,
											);
											const peers = report.contributions.filter(
												(item) => item.repositoryKey === row.repositoryKey,
											);
											const rank =
												1 +
												peers.filter((item) => item.total > row.total).length;
											return (
												<TableRow key={row.repositoryKey}>
													<TableCell className="font-medium">
														{repo?.name ?? row.repositoryKey}
													</TableCell>
													<CountCells counts={row} />
													<TableCell className="text-right tabular-nums">
														{percent(row.total, repo?.total ?? 0)}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{rank} / {peers.length}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						) : (
							<EmptyState
								compact
								icon={GitPullRequest}
								title="No PRs in this period"
								description="This followed person remains visible even without matching PRs. Calculate to discover missing history."
							/>
						)}
					</>
				) : (
					<EmptyState
						compact
						icon={Users}
						title="No matching contributors"
						description="Follow a PR author or broaden the contributor filters."
					/>
				)}
			</LayerCard.Well>
		</LayerCard>
	);
}

function RepositoryReport({ report }: { report: ContributionReport }) {
	const [requested, select] = useState("");
	const [requestedPage, setPage] = useState(1);
	const repository =
		report.repositories.find((row) => row.key === requested) ??
		report.repositories[0];
	const authors = report.contributions
		.filter((row) => row.repositoryKey === repository?.key)
		.sort(
			(a, b) =>
				b.total - a.total ||
				a.name.localeCompare(b.name) ||
				a.key.localeCompare(b.key),
		);
	const selected = authors.filter((row) => row.selected);
	const selectedTotal = selected.reduce((sum, row) => sum + row.total, 0);
	const pages = Math.max(1, Math.ceil(authors.length / 20));
	const page = Math.min(requestedPage, pages);
	const visible = authors.slice((page - 1) * 20, page * 20);
	return (
		<LayerCard padding="none" aria-label="Repository perspective">
			<LayerCard.Header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold">Repository perspective</h2>
					<p className="mt-1 text-xs text-basalt-muted-foreground">
						Repository totals include every visible author. Contributor filters
						highlight people without changing the comparison.
					</p>
				</div>
				{repository ? (
					<SelectControl
						aria-label="Repository"
						value={repository.key}
						onChange={(key) => {
							select(key);
							setPage(1);
						}}
						className="w-64 max-w-full"
					>
						{report.repositories.map((repo) => (
							<option key={repo.key} value={repo.key}>
								{repo.name} · {repo.total} PRs
							</option>
						))}
					</SelectControl>
				) : null}
			</LayerCard.Header>
			<LayerCard.Well className="space-y-3">
				{repository ? (
					<>
						<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
							<span>
								<strong>{repository.total}</strong> repository PRs
							</span>
							<span>
								<strong>{authors.length}</strong> authors
							</span>
							<span>
								<strong>{selectedTotal}</strong> selected PRs ·{" "}
								{percent(selectedTotal, repository.total)} of repository
							</span>
						</div>
						{selected.length ? (
							<div className="flex flex-wrap items-center gap-2 text-xs">
								{selected.slice(0, 10).map((row) => (
									<Badge key={row.key} variant="secondary">
										{row.name} · {row.total} PRs ·{" "}
										{percent(row.total, repository.total)} · #
										{1 +
											authors.filter((peer) => peer.total > row.total).length}
									</Badge>
								))}
							</div>
						) : null}
						<div className="overflow-x-auto">
							<Table
								aria-label="Repository contributor counts"
								className="min-w-[720px] text-xs"
							>
								<TableHeader>
									<TableRow>
										<TableHead className="w-12 text-right">Rank</TableHead>
										<TableHead>Contributor</TableHead>
										<CountHeaders />
										<TableHead className="text-right">Repo share</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{visible.map((row) => (
										<TableRow
											key={row.key}
											data-state={row.selected ? "selected" : undefined}
										>
											<TableCell className="text-right tabular-nums">
												{1 +
													authors.filter((peer) => peer.total > row.total)
														.length}
											</TableCell>
											<TableCell>
												<Author row={row} />
												{row.selected ? (
													<span className="text-[11px] text-basalt-muted-foreground">
														Selected contributor
													</span>
												) : null}
											</TableCell>
											<CountCells counts={row} />
											<TableCell className="text-right tabular-nums">
												{percent(row.total, repository.total)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<div className="flex items-center justify-between gap-3 text-xs text-basalt-muted-foreground">
							<span>
								{(page - 1) * 20 + 1}–{Math.min(page * 20, authors.length)} of{" "}
								{authors.length} contributors
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="icon"
									className="h-7 w-7"
									aria-label="Previous contributor page"
									disabled={page <= 1}
									onClick={() => setPage(page - 1)}
								>
									<ChevronLeft className="h-4 w-4" aria-hidden />
								</Button>
								<span>
									{page} / {pages}
								</span>
								<Button
									variant="outline"
									size="icon"
									className="h-7 w-7"
									aria-label="Next contributor page"
									disabled={page >= pages}
									onClick={() => setPage(page + 1)}
								>
									<ChevronRight className="h-4 w-4" aria-hidden />
								</Button>
							</div>
						</div>
					</>
				) : (
					<EmptyState
						compact
						icon={GitPullRequest}
						title="No discovered repository PRs"
						description="Calculate to discover PRs for this period, or broaden the repository filters."
					/>
				)}
			</LayerCard.Well>
		</LayerCard>
	);
}
