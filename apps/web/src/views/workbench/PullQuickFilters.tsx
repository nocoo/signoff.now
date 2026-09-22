import { Button } from "@nocoo/basalt";
import {
	CheckCheck,
	CircleHelp,
	Eye,
	EyeOff,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Layers,
	type LucideIcon,
	ShieldAlert,
} from "lucide-react";
import { SelectControl } from "@/components/SelectControl";
import { cn } from "@/lib/utils";
import type { useWorkbench } from "@/viewmodels/WorkbenchProvider";

const states = [
	[
		"open",
		"Open",
		GitPullRequest,
		"text-emerald-600 hover:text-emerald-600 basalt-dark:text-emerald-400 basalt-dark:hover:text-emerald-400",
	],
	["draft", "Draft", GitPullRequestDraft, "text-basalt-muted-foreground"],
	[
		"merged",
		"Merged",
		GitMerge,
		"text-violet-600 hover:text-violet-600 basalt-dark:text-violet-400 basalt-dark:hover:text-violet-400",
	],
	[
		"closed",
		"Closed",
		GitPullRequestClosed,
		"text-rose-600 hover:text-rose-600 basalt-dark:text-rose-400 basalt-dark:hover:text-rose-400",
	],
	[
		"all",
		"All states",
		Layers,
		"text-slate-600 hover:text-slate-600 basalt-dark:text-slate-400 basalt-dark:hover:text-slate-400",
	],
] as const;
const watches = [
	[
		"watching",
		"Watched",
		Eye,
		"text-teal-600 hover:text-teal-600 basalt-dark:text-teal-400 basalt-dark:hover:text-teal-400",
	],
	[
		"unwatched",
		"Unwatched",
		EyeOff,
		"text-slate-600 hover:text-slate-600 basalt-dark:text-slate-400 basalt-dark:hover:text-slate-400",
	],
] as const;
const readiness = [
	["conflict", "Conflict", ShieldAlert, "text-basalt-destructive"],
	["attention", "Attention", ShieldAlert, "text-basalt-destructive"],
	["warning", "Warning", ShieldAlert, "text-basalt-warning"],
	["running", "Running", CheckCheck, "text-basalt-primary"],
	["ready", "Ready", CheckCheck, "text-basalt-success"],
	["waiting", "Waiting", Eye, "text-basalt-muted-foreground"],
	["skipped", "Skipped", EyeOff, "text-basalt-badge-teal"],
] as const;

function FilterChip({
	label,
	Icon,
	color,
	selected,
	count,
	disabled = false,
	title,
	onClick,
}: {
	label: string;
	Icon: LucideIcon;
	color: string;
	selected: boolean;
	count?: number | null;
	disabled?: boolean;
	title: string;
	onClick: () => void;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			aria-label={label}
			aria-pressed={selected}
			disabled={disabled}
			title={title}
			onClick={onClick}
			className={cn(
				"h-8 shrink-0 gap-1.5 whitespace-nowrap border border-transparent px-2 text-[11px] hover:bg-current/5 aria-pressed:border-current/30 aria-pressed:bg-current/10",
				color,
			)}
		>
			<Icon aria-hidden strokeWidth={1.7} className="size-3.5" />
			<span className={cn(!selected && "text-basalt-muted-foreground")}>
				{label}
			</span>
			{count !== undefined ? (
				<span className="font-mono text-[11px] tabular-nums opacity-80">
					{count === null ? "—" : count.toLocaleString()}
				</span>
			) : null}
		</Button>
	);
}

export function PullQuickFilters({
	vm,
}: {
	vm: Pick<
		ReturnType<typeof useWorkbench>,
		"filter" | "setFilter" | "metrics" | "pullsLoaded"
	>;
}) {
	const { filter } = vm;
	const historical = filter.state === "merged" || filter.state === "closed";
	const detailed = ["unknown", "error"].includes(filter.status);
	return (
		<section
			aria-label="Quick PR filters"
			className="max-w-full overflow-x-auto py-1"
		>
			<div className="flex w-max min-w-full items-center gap-2">
				<fieldset
					aria-label="PR state: choose one"
					className="flex shrink-0 items-center gap-0.5"
				>
					{states.map(([state, label, Icon, color]) => (
						<FilterChip
							key={state}
							label={label}
							Icon={Icon}
							color={color}
							selected={
								state === "draft"
									? filter.state === "open" && filter.draft === "only"
									: filter.state === state &&
										!(state === "open" && filter.draft === "only")
							}
							count={
								state === "all"
									? undefined
									: vm.pullsLoaded
										? state === "open"
											? vm.metrics.open - vm.metrics.draft
											: vm.metrics[state]
										: null
							}
							title={`Show ${state === "all" ? "all" : state} PRs`}
							onClick={() =>
								vm.setFilter(
									state === "draft"
										? { state: "open", draft: "only" }
										: {
												state,
												draft: state === "open" ? "exclude" : "include",
											},
								)
							}
						/>
					))}
				</fieldset>
				<fieldset
					aria-label="Watch status: optional, choose one"
					className="flex shrink-0 items-center gap-0.5 border-l border-basalt-border pl-2"
				>
					{watches.map(([watching, label, Icon, color]) => (
						<FilterChip
							key={watching}
							label={label}
							Icon={Icon}
							color={color}
							selected={filter.watching === watching}
							title={
								filter.watching === watching
									? "Clear watch filter"
									: watching === "watching"
										? "Only watched PRs (returns to Open from history)"
										: "Only unwatched PRs"
							}
							onClick={() =>
								vm.setFilter({
									watching: filter.watching === watching ? "all" : watching,
								})
							}
						/>
					))}
				</fieldset>
				<fieldset
					aria-label="Open PR readiness: optional, choose one"
					className="flex shrink-0 items-center gap-0.5 border-l border-basalt-border pl-2"
				>
					{readiness.map(([status, label, Icon, color]) => (
						<FilterChip
							key={status}
							label={label}
							Icon={Icon}
							color={color}
							selected={filter.status === status}
							count={vm.pullsLoaded ? vm.metrics[status] : null}
							disabled={historical}
							title={
								historical
									? "Readiness applies to open PRs"
									: filter.status === status
										? "Clear readiness filter"
										: `Only open PRs: ${label.toLowerCase()}`
							}
							onClick={() =>
								vm.setFilter({
									status: filter.status === status ? "all" : status,
								})
							}
						/>
					))}
					<CircleHelp
						aria-hidden
						className={cn(
							"ml-1 size-3.5 shrink-0",
							detailed
								? "text-amber-600 hover:text-amber-600 basalt-dark:text-amber-400 basalt-dark:hover:text-amber-400"
								: "text-basalt-muted-foreground",
						)}
					/>
					<SelectControl
						aria-label="Detailed readiness"
						disabled={historical}
						value={detailed ? filter.status : "all"}
						onChange={(status) =>
							vm.setFilter({ status: status as typeof filter.status })
						}
						className={cn(
							"h-8 w-auto min-w-20 shrink-0 border-transparent bg-transparent px-2 text-[11px] shadow-none",
							detailed &&
								"border-amber-500/30 bg-amber-500/10 text-amber-700 basalt-dark:text-amber-300",
						)}
						contentClassName="[&_[role=option]]:text-xs"
					>
						<option value="all">More</option>
						<option value="error">Error</option>
						<option value="unknown">Unknown / incomplete</option>
					</SelectControl>
				</fieldset>
			</div>
		</section>
	);
}
