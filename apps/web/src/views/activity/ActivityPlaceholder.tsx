import { Activity } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export function ActivityPlaceholder() {
	return (
		<div className="space-y-6">
			<PageHeader
				title="Activity"
				description="Read-only heatmaps and scores — written exclusively by the local pipeline."
			/>
			<div className="rounded-[var(--radius-card)] bg-secondary">
				<EmptyState
					icon={Activity}
					title="Heatmap coming after ingest"
					description="Activity and Score rows are not editable in the browser. Once pipeline ingest writes D1, this page will show heatmaps, daily scores, and multi-select comparison."
					action={
						<div className="flex flex-wrap justify-center gap-2">
							<Link
								to="/repos"
								className="inline-flex h-9 items-center justify-center rounded-md bg-secondary border border-border px-4 text-sm font-medium hover:bg-accent transition-colors"
							>
								Bind repos
							</Link>
							<Link
								to="/settings"
								className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-secondary px-4 text-sm font-medium hover:bg-accent transition-colors"
							>
								Check settings
							</Link>
						</div>
					}
				/>
			</div>
			<div className="grid gap-3 sm:grid-cols-3">
				{[
					{
						title: "Collect",
						body: "Local CLI / scripts pull ADO with az credentials.",
						tone: "bg-ms-blue/15 text-ms-blue",
					},
					{
						title: "Ingest",
						body: "Validated payloads land in D1 Activities & Scores.",
						tone: "bg-ms-green/15 text-ms-green",
					},
					{
						title: "Explore",
						body: "Managers view heatmaps and compare developers here.",
						tone: "bg-ms-yellow/15 text-ms-yellow",
					},
				].map((step) => (
					<div
						key={step.title}
						className="rounded-[var(--radius-card)] bg-secondary p-4 space-y-2"
					>
						<span
							className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${step.tone}`}
						>
							{step.title}
						</span>
						<p className="text-sm text-muted-foreground">{step.body}</p>
					</div>
				))}
			</div>
		</div>
	);
}
