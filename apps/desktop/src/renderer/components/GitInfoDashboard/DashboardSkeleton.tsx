/**
 * DashboardSkeleton — loading placeholder for the GitInfo dashboard.
 */

const SKELETON_KEYS = [
	"overview",
	"branches",
	"activity",
	"contributors",
	"files",
	"tags",
	"status",
	"config",
];

export function DashboardSkeleton() {
	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="mx-auto grid max-w-6xl grid-cols-2 gap-4">
				{SKELETON_KEYS.map((key) => (
					<div
						key={key}
						className="animate-pulse rounded-lg border border-border bg-card p-4"
					>
						<div className="mb-3 flex items-center gap-2">
							<div className="h-4 w-4 rounded bg-muted" />
							<div className="h-4 w-20 rounded bg-muted" />
						</div>
						<div className="space-y-2">
							<div className="h-3 w-3/4 rounded bg-muted" />
							<div className="h-3 w-1/2 rounded bg-muted" />
							<div className="h-3 w-2/3 rounded bg-muted" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
