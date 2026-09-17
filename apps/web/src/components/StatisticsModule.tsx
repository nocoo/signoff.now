import { Badge, Button, LayerCard } from "@nocoo/basalt";
import type { ContributionSnapshot } from "@signoff/domain/insights";
import { BarChart3, Clock3, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { calculationFreshness, relativeAge } from "@/models/freshness";
import type { useContributionModule } from "@/viewmodels/useContributionModule";
import { AlertBanner } from "./AlertBanner";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

export function StatisticsModule({
	title,
	description,
	state,
	now,
	disabled = false,
	className,
	children,
}: {
	title: string;
	description?: string;
	state: ReturnType<typeof useContributionModule>;
	now: number;
	disabled?: boolean;
	className?: string;
	children: (snapshot: ContributionSnapshot) => ReactNode;
}) {
	const timestamp = state.snapshot?.calculatedAt ?? null;
	const freshness = calculationFreshness(timestamp, now);
	const variant =
		freshness === "stale"
			? "destructive"
			: freshness === "warning"
				? "warning"
				: "secondary";
	return (
		<LayerCard padding="none" className={className} aria-label={title}>
			<LayerCard.Header className="block space-y-1.5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="text-sm font-semibold text-basalt-foreground">
						{title}
					</h2>
					<div className="flex flex-wrap items-center gap-2">
						<Badge
							variant={variant}
							className="gap-1 text-xs font-normal"
							title={
								timestamp === null
									? "No saved calculation for these filters"
									: `Last calculated ${new Date(timestamp * 1000).toLocaleString()}. Yellow after 24 hours; red after 72 hours.`
							}
						>
							<Clock3 className="h-3 w-3" aria-hidden />
							{timestamp === null
								? "Not calculated"
								: `Calculated ${relativeAge(timestamp, now)}`}
						</Badge>
						<Button
							variant="outline"
							size="sm"
							disabled={disabled || state.refreshing}
							aria-label={`${timestamp === null ? "Calculate" : "Refresh"} ${title}`}
							onClick={() => void state.refresh()}
						>
							<RefreshCw
								className={`h-3.5 w-3.5 ${state.refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
								aria-hidden
							/>
							{state.refreshing
								? "Calculating…"
								: timestamp === null
									? "Calculate"
									: "Refresh"}
						</Button>
					</div>
				</div>
				{description ? (
					<p className="text-xs text-basalt-muted-foreground">{description}</p>
				) : null}
			</LayerCard.Header>
			<LayerCard.Well
				className="space-y-3"
				aria-busy={state.refreshing || state.loading}
			>
				{state.error ? (
					<AlertBanner variant="error">{state.error}</AlertBanner>
				) : null}
				{state.snapshot ? (
					children(state.snapshot)
				) : state.loading ? (
					<div className="space-y-3 py-5">
						<Skeleton className="h-6 w-1/3" />
						<Skeleton className="h-32 w-full" />
					</div>
				) : (
					<EmptyState
						compact
						icon={BarChart3}
						title="No saved calculation"
						description={
							disabled
								? "Choose valid filters to calculate this module."
								: "Calculate this module for the selected filters. It stays unchanged until you refresh it."
						}
					/>
				)}
			</LayerCard.Well>
		</LayerCard>
	);
}
