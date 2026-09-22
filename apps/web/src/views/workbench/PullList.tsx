import { Badge, Button, Checkbox, LayerCard } from "@nocoo/basalt";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { pullUrl, repositoryBranchUrl } from "@signoff/domain/workbench";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Eye,
	EyeOff,
	GitBranch,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { EntityLabel } from "@/components/EntityAvatar";
import { Skeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { relativeAge } from "@/models/freshness";
import { type AiSchedule, readinessDisplay } from "@/models/readinessDisplay";
import type { PullFilter, PullRow } from "@/models/workbench";
import { useMinuteNow } from "@/viewmodels/useMinuteNow";
import { usePullTableLayout } from "@/viewmodels/usePullTableLayout";
import { PrCollectionMarker } from "../collections/PrCollectionMemberships";
import { ReadinessCell } from "./ReadinessCell";
import { RepositoryScopeLinks } from "./RepositoryFilters";
import { LifecycleBadge, StageBar } from "./WorkbenchStatus";

const repositoryColumn = "group-data-[hidden-columns~=repository]/pulls:hidden";
const authorColumn = "group-data-[hidden-columns~=author]/pulls:hidden";
const columnDefinitions = [
	["title", "Pull request", ""],
	["repository", "Repository", repositoryColumn],
	["author", "Author", authorColumn],
	["readiness", "Readiness", ""],
	["progress", "Checks & stages", "!w-full min-w-56"],
	["action", "Next action", ""],
	["evaluated", "Jev evaluated", "text-right"],
	["updated", "PR updated", "text-right"],
	["stateChecked", "State checked", "text-right"],
	["checksChecked", "Checks collected", "text-right"],
] as const;
export type PullColumn = (typeof columnDefinitions)[number][0];
const defaultColumns = columnDefinitions.map(([key]) => key);
type PullListProps = {
	rows: PullRow[];
	loading: boolean;
	busy: boolean;
	label?: string;
	columns?: readonly PullColumn[];
	sort: Pick<PullFilter, "sort" | "sortDirection">;
	onSort: (column: PullColumn) => void;
	onOpen: (row: PullRow, element: HTMLButtonElement) => void;
	onToggleWatch: (row: PullRow) => void;
	aiSchedule: AiSchedule | null;
	selection?: {
		ids: Set<string>;
		header: ReactNode;
		onToggle: (id: string, checked: boolean) => void;
		canSelect?: (row: PullRow) => boolean;
	};
	actions?: (row: PullRow) => ReactNode;
};
export function PullList({
	rows,
	loading,
	busy,
	label = "Pull requests",
	columns = defaultColumns,
	sort,
	onSort,
	onOpen,
	onToggleWatch,
	aiSchedule,
	selection,
	actions,
}: PullListProps) {
	const tableContainer = usePullTableLayout();
	const now = useMinuteNow();
	const evaluationNow = Math.floor(Date.now() / 1000);
	return (
		<div ref={tableContainer} className="group/pulls overflow-x-auto">
			<Table
				aria-label={label}
				aria-busy={loading}
				className="table-auto text-[11px] [&_th]:w-px [&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:whitespace-nowrap [&_td]:px-3"
			>
				<TableHeader>
					<TableRow>
						{selection ? (
							<TableHead className="px-2 text-center">
								<div className="flex items-center justify-center">
									{selection.header}
								</div>
							</TableHead>
						) : null}
						<TableHead className="px-1 text-center">
							<span className="sr-only">Watch list</span>
							<Eye aria-hidden className="mx-auto size-3.5" />
						</TableHead>
						{columnDefinitions
							.filter(([column]) => columns.includes(column))
							.map(([column, title, className]) => (
								<SortableHead
									key={column}
									sort={column}
									label={title}
									className={className}
									filter={sort}
									disabled={loading}
									onSort={() => onSort(column)}
								/>
							))}
						{actions ? (
							<TableHead className="sticky right-0 bg-[var(--basalt-control-fill)]">
								<span className="sr-only">PR actions</span>
							</TableHead>
						) : null}
					</TableRow>
				</TableHeader>
				<TableBody>
					{loading ? (
						<PullTableSkeleton
							columns={columns}
							selectable={Boolean(selection)}
							actions={Boolean(actions)}
						/>
					) : (
						rows.map((item) => (
							<PullTableRow
								key={item.pull.id}
								row={item}
								selection={selection}
								busy={busy}
								now={now}
								aiSchedule={aiSchedule}
								evaluationNow={evaluationNow}
								onOpen={(element) => onOpen(item, element)}
								onToggleWatch={onToggleWatch}
								columns={columns}
								actions={actions}
							/>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
function PullTableSkeleton({
	columns,
	selectable,
	actions,
}: {
	columns: readonly PullColumn[];
	selectable: boolean;
	actions: boolean;
}) {
	return [1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
		<TableRow
			key={row}
			aria-hidden="true"
			className="pointer-events-none h-16 [&_td]:py-2 [&_td]:align-middle [&_div[aria-hidden=true]]:bg-basalt-muted-foreground/10"
		>
			{selectable ? (
				<TableCell>
					<Skeleton className="mx-auto h-4 w-4 [&>div]:rounded" />
				</TableCell>
			) : null}
			<TableCell>
				<div className="mx-auto flex h-8 w-8 items-center justify-center rounded-md bg-basalt-primary/5">
					<Skeleton className="h-4 w-4 [&>div]:rounded-full" />
				</div>
			</TableCell>
			{columns.includes("title") ? (
				<TableCell>
					<div className="w-[32rem] space-y-2">
						<Skeleton
							className={cn("h-3", row % 3 === 0 ? "w-3/4" : "w-11/12")}
						/>
						<div className="flex items-center gap-2">
							<Skeleton className="h-2.5 w-10" />
							<Skeleton className="h-5 w-12 [&>div]:rounded-full" />
							<Skeleton className="h-2.5 w-28" />
						</div>
					</div>
				</TableCell>
			) : null}
			{columns.includes("repository") ? (
				<TableCell className={repositoryColumn}>
					<Skeleton className="h-2.5 w-44" />
				</TableCell>
			) : null}
			{columns.includes("author") ? (
				<TableCell className={authorColumn}>
					<div className="flex items-center gap-2">
						<Skeleton className="h-5 w-5 [&>div]:rounded-full" />
						<Skeleton className="h-2.5 w-16" />
					</div>
				</TableCell>
			) : null}
			{columns.includes("readiness") ? (
				<TableCell>
					<Skeleton className="h-6 w-24 [&>div]:rounded-full" />
				</TableCell>
			) : null}
			{columns.includes("progress") ? (
				<TableCell>
					<div className="mb-1 flex items-center justify-between gap-4">
						<Skeleton className="h-3 w-20" />
						<Skeleton className="h-2.5 w-10" />
					</div>
					<div className="flex gap-1">
						{[1, 2, 3, 4, 5, 6, 7, 8].map((stage) => (
							<Skeleton key={stage} className="h-1.5 min-w-0 flex-1" />
						))}
					</div>
					<Skeleton className="mt-1 h-2.5 w-28" />
				</TableCell>
			) : null}
			{columns.includes("action") ? (
				<TableCell>
					<Skeleton className="h-2.5 w-64" />
				</TableCell>
			) : null}
			{(["evaluated", "updated", "stateChecked", "checksChecked"] as const)
				.filter((column) => columns.includes(column))
				.map((column) => (
					<TableCell key={column}>
						<Skeleton className="ml-auto h-2.5 w-14" />
					</TableCell>
				))}
			{actions ? (
				<TableCell className="sticky right-0 bg-[var(--basalt-control-fill)]">
					<Skeleton className="mx-auto size-4" />
				</TableCell>
			) : null}
		</TableRow>
	));
}

function SortableHead({
	sort,
	label,
	className,
	filter,
	disabled,
	onSort,
}: {
	sort: PullFilter["sort"];
	label: string;
	className: string;
	filter: Pick<PullFilter, "sort" | "sortDirection">;
	disabled: boolean;
	onSort: () => void;
}) {
	const active = filter.sort === sort;
	const Icon = active
		? filter.sortDirection === "asc"
			? ArrowUp
			: ArrowDown
		: ArrowUpDown;
	return (
		<TableHead
			className={className}
			aria-sort={
				active
					? filter.sortDirection === "asc"
						? "ascending"
						: "descending"
					: "none"
			}
		>
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Sort by ${label}`}
				disabled={disabled}
				onClick={onSort}
				className={cn(
					"h-8 gap-1 px-0 text-xs hover:bg-transparent",
					active && "text-basalt-foreground",
				)}
			>
				{label}
				<Icon className="h-3 w-3 shrink-0" aria-hidden />
			</Button>
		</TableHead>
	);
}

function PullSourceLink({ pull, project }: Pick<PullRow, "pull" | "project">) {
	if (project.source !== "cli") return null;
	return (
		<Button
			asChild
			variant="ghost"
			size="icon"
			className="h-5 w-5 shrink-0 text-basalt-muted-foreground"
		>
			<a
				href={pullUrl(project, pull)}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Open PR #${pull.number} in ${project.provider === "ado" ? "Azure DevOps" : "GitHub"} (new tab)`}
				title="Open source PR in a new tab"
			>
				<ExternalLink className="h-3.5 w-3.5" aria-hidden />
			</a>
		</Button>
	);
}

function PullTableRow({
	row,
	selection,
	busy,
	onToggleWatch,
	actions,
	columns,
	now,
	aiSchedule,
	evaluationNow,
	onOpen,
}: {
	row: PullRow;
	selection?: PullListProps["selection"];
	busy: boolean;
	onToggleWatch: (row: PullRow) => void;
	actions?: PullListProps["actions"];
	columns: readonly PullColumn[];
	now: number;
	aiSchedule: AiSchedule | null;
	evaluationNow: number;
	onOpen: (element: HTMLButtonElement) => void;
}) {
	const { pull, project, readiness, progress, observation } = row;
	const watching = row.watching ?? Boolean(observation?.active);
	const evaluation = readiness.current ?? readiness.previous;
	const evaluatedAt = evaluation
		? Date.parse(evaluation.evaluatedAt) / 1000
		: null;
	const stateAt = pull.summaryObservedAt ?? pull.observedAt;
	const checksAt =
		pull.checksObservedAt === null
			? null
			: (pull.checksObservedAt ?? pull.observedAt);

	const cells: Record<PullColumn, ReactNode> = {
		title: (
			<TableCell className="py-2 align-middle">
				<div className="flex items-start gap-1.5">
					<Button
						variant="link"
						className="h-auto min-w-0 justify-start whitespace-nowrap p-0 text-left text-xs font-semibold leading-5 text-basalt-foreground"
						aria-label={`Open PR #${pull.number}: ${pull.title}`}
						onClick={(event) => {
							onOpen(event.currentTarget);
						}}
					>
						{pull.title}
					</Button>
					<PullSourceLink pull={pull} project={project} />
				</div>
				<div className="mt-1 flex items-center gap-x-1.5 gap-y-1 text-[11px] text-basalt-muted-foreground">
					<a
						href={pullUrl(project, pull)}
						target="_blank"
						rel="noopener noreferrer"
						title={`Open PR #${pull.number} in ${project.provider === "ado" ? "Azure DevOps" : "GitHub"} (new tab)`}
						className="rounded-sm font-mono text-basalt-foreground/75 underline-offset-4 hover:text-basalt-primary hover:underline focus-visible:outline-2 focus-visible:outline-basalt-ring"
					>
						#{pull.number}
					</a>
					<LifecycleBadge pull={pull} />
					<a
						href={repositoryBranchUrl(
							project,
							pull.repository,
							pull.targetBranch,
						)}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={`Open target branch ${pull.targetBranch} in ${project.projectKey}/${pull.repository.name} (new tab)`}
						title={`Target branch: ${pull.targetBranch} · Open in a new tab`}
						className="flex min-w-0 items-center gap-1.5 rounded-sm font-mono text-[11px] text-basalt-muted-foreground underline-offset-4 hover:text-basalt-primary hover:underline focus-visible:outline-2 focus-visible:outline-basalt-ring"
					>
						<GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
						<span className="whitespace-nowrap">{pull.targetBranch}</span>
					</a>
					<PrCollectionMarker id={pull.id} number={pull.number} />
					{pull.labels.includes("release blocker") ? (
						<Badge variant="error" className="ml-2 px-1.5 py-0 text-[11px]">
							release blocker
						</Badge>
					) : null}
				</div>
			</TableCell>
		),
		repository: (
			<TableCell
				className={cn(repositoryColumn, "py-2 align-middle text-[11px]")}
			>
				<RepositoryScopeLinks project={project} repository={pull.repository} />
			</TableCell>
		),
		author: (
			<TableCell className={cn(authorColumn, "py-2 align-middle text-[11px]")}>
				<EntityLabel
					name={pull.author.name}
					avatarUrl={pull.author.avatarUrl}
					size="xs"
				/>
			</TableCell>
		),
		readiness: (
			<TableCell className="py-2 align-middle">
				<ReadinessCell
					display={readinessDisplay(
						readiness,
						pull.id,
						aiSchedule,
						evaluationNow,
					)}
					failed={readiness.status === "error"}
				/>
			</TableCell>
		),
		progress: (
			<TableCell className="py-2 align-middle">
				{pull.checksObservedAt === null ? (
					<p
						className="text-[11px] text-basalt-muted-foreground"
						title="Add to watch list to collect policies, builds and stages"
					>
						Checks not collected
					</p>
				) : (
					<>
						<div className="mb-1 flex items-baseline justify-between gap-4 text-xs">
							<span className="font-medium tabular-nums">
								{progress.checksPassed}/{progress.checksTotal} required
							</span>
							<span className="text-[11px] text-basalt-muted-foreground">
								{pull.builds.length} builds
							</span>
						</div>
						<StageBar builds={pull.builds} />
						<p className="mt-1 text-[11px] text-basalt-muted-foreground">
							{progress.stagesPassed}/{progress.stagesTotal} stages passed
							{progress.optionalFailures
								? ` · ${progress.optionalFailures} advisory`
								: ""}
						</p>
					</>
				)}
			</TableCell>
		),
		action: (
			<TableCell className="py-2 align-middle">
				<p className="text-[11px] leading-4" title={readiness.nextAction}>
					{readiness.nextAction}
				</p>
			</TableCell>
		),
		evaluated: (
			<TableCell className="py-2 align-middle text-right text-[11px] text-basalt-muted-foreground">
				{evaluation && evaluatedAt !== null ? (
					<time
						dateTime={evaluation.evaluatedAt}
						title={`Last successful Jev evaluation: ${new Date(evaluation.evaluatedAt).toLocaleString()}${readiness.current ? "" : " · Previous evidence"}`}
					>
						{relativeAge(evaluatedAt, now)}
					</time>
				) : (
					<span
						title={
							readiness.kind === "skipped"
								? "Jev evaluation skipped for this target branch"
								: "No successful Jev evaluation"
						}
					>
						—
					</span>
				)}
			</TableCell>
		),
		updated: (
			<TableCell className="py-2 align-middle text-right text-[11px] whitespace-nowrap text-basalt-muted-foreground">
				<time
					dateTime={new Date(pull.updatedAt * 1000).toISOString()}
					title={new Date(pull.updatedAt * 1000).toLocaleString()}
				>
					{relativeAge(pull.updatedAt, now)}
				</time>
			</TableCell>
		),
		stateChecked: (
			<TableCell className="py-2 align-middle text-right text-[11px] whitespace-nowrap text-basalt-muted-foreground">
				<time
					dateTime={new Date(stateAt * 1000).toISOString()}
					title={`PR state checked: ${new Date(stateAt * 1000).toLocaleString()}`}
				>
					{relativeAge(stateAt, now)}
				</time>
			</TableCell>
		),
		checksChecked: (
			<TableCell className="py-2 align-middle text-right text-[11px] whitespace-nowrap text-basalt-muted-foreground">
				{checksAt === null ? (
					<abbr title="Checks have not been collected" className="no-underline">
						—
					</abbr>
				) : (
					<time
						dateTime={new Date(checksAt * 1000).toISOString()}
						title={`Checks collected: ${new Date(checksAt * 1000).toLocaleString()}${pull.checksInvalidated ? " · PR changed; checks need refreshing" : ""}`}
					>
						{pull.checksInvalidated ? "outdated" : relativeAge(checksAt, now)}
					</time>
				)}
			</TableCell>
		),
	};
	return (
		<TableRow
			data-pull-id={pull.id}
			className="group h-16"
			aria-selected={selection?.ids.has(pull.id)}
		>
			{selection ? (
				<TableCell className="w-10 px-2 py-2 align-middle">
					<div className="flex items-center justify-center">
						<Checkbox
							aria-label={`Select PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`}
							checked={selection?.ids.has(pull.id)}
							disabled={
								busy ||
								(selection.canSelect
									? !selection.canSelect(row)
									: pull.state !== "open" && !observation?.active)
							}
							onCheckedChange={(checked) =>
								selection?.onToggle(pull.id, checked === true)
							}
						/>
					</div>
				</TableCell>
			) : null}
			<TableCell className="w-12 px-1 py-2 align-middle">
				<div className="flex items-center justify-center">
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							"h-8 w-8",
							watching
								? "bg-basalt-primary/10 text-basalt-primary hover:bg-basalt-primary/15 hover:text-basalt-primary"
								: "text-basalt-muted-foreground hover:bg-basalt-muted hover:text-basalt-foreground",
						)}
						aria-label={`Watch PR #${pull.number} in ${project.projectKey}/${pull.repository.name}`}
						aria-pressed={watching}
						aria-busy={Boolean(row.watchPending)}
						title={
							row.watchPending
								? "Saving watch list change…"
								: watching
									? "In watch list · Click to remove"
									: pull.state === "open"
										? "Not in watch list · Click to watch"
										: "Completed PRs are no longer watched"
						}
						disabled={
							busy ||
							row.watchPending ||
							(pull.state !== "open" && !observation?.active)
						}
						onClick={() => onToggleWatch(row)}
					>
						{watching ? (
							<Eye aria-hidden className="h-4 w-4" />
						) : (
							<EyeOff aria-hidden className="h-4 w-4" />
						)}
					</Button>
				</div>
			</TableCell>

			{defaultColumns
				.filter((column) => columns.includes(column))
				.map((column) => (
					<Fragment key={column}>{cells[column]}</Fragment>
				))}
			{actions ? (
				<TableCell className="sticky right-0 bg-[var(--basalt-control-fill)] px-2 py-2 align-middle">
					{actions(row)}
				</TableCell>
			) : null}
		</TableRow>
	);
}

export function PullListPagination({
	page,
	pageSize,
	total,
	loaded,
	loading,
	busy = false,
	onPage,
}: {
	page: number;
	pageSize: number;
	total: number;
	loaded: boolean;
	loading: boolean;
	busy?: boolean;
	onPage: (page: number) => void;
}) {
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	if (total === 0 && page <= 1) return null;
	return (
		<LayerCard.Footer className="justify-between">
			<p className="text-xs text-basalt-muted-foreground">
				{loaded
					? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} pull requests`
					: loading
						? "Loading pull requests…"
						: "Result count unavailable"}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="icon"
					className="h-7 w-7"
					aria-label="Previous page"
					disabled={page <= 1 || busy}
					onClick={() => onPage(page - 1)}
				>
					<ChevronLeft aria-hidden className="h-4 w-4" />
				</Button>
				<span className="text-xs tabular-nums">
					{loaded ? `${page} / ${pageCount}` : `Page ${page}`}
				</span>
				<Button
					variant="outline"
					size="icon"
					className="h-7 w-7"
					aria-label="Next page"
					disabled={!loaded || page >= pageCount || busy}
					onClick={() => onPage(page + 1)}
				>
					<ChevronRight aria-hidden className="h-4 w-4" />
				</Button>
			</div>
		</LayerCard.Footer>
	);
}
