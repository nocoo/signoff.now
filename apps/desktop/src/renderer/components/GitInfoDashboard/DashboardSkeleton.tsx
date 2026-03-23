/**
 * DashboardSkeleton — loading placeholder for the GitInfo dashboard.
 * Shows skeleton content cards in a single column.
 */

const LINE_WIDTHS = [
	"w-3/4",
	"w-1/2",
	"w-2/3",
	"w-5/6",
	"w-1/3",
	"w-4/5",
	"w-2/5",
	"w-3/5",
];

const SKELETON_CARDS = [
	{ key: "stats", widths: LINE_WIDTHS.slice(0, 3) },
	{ key: "chart", widths: LINE_WIDTHS.slice(0, 6) },
	{ key: "table", widths: LINE_WIDTHS.slice(0, 5) },
];

export function DashboardSkeleton() {
	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				{SKELETON_CARDS.map((card) => (
					<div
						key={card.key}
						className="animate-pulse rounded-lg border border-border bg-card p-4"
					>
						<div className="mb-3 flex items-center gap-2">
							<div className="h-4 w-4 rounded bg-muted" />
							<div className="h-4 w-24 rounded bg-muted" />
						</div>
						<div className="space-y-2">
							{card.widths.map((w) => (
								<div
									key={`${card.key}-${w}`}
									className={`h-3 rounded bg-muted ${w}`}
								/>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
