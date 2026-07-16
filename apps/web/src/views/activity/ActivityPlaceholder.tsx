export function ActivityPlaceholder() {
	return (
		<div className="space-y-3">
			<h2 className="font-display text-xl font-semibold">Activity</h2>
			<p className="text-sm text-muted-foreground">
				Activity and Score are written only by the local pipeline (CLI /
				scripts). This Web UI is read-only for analytics data.
			</p>
			<p className="text-sm text-muted-foreground">
				Heatmap and detail views will land after the ingest path is implemented.
			</p>
		</div>
	);
}
