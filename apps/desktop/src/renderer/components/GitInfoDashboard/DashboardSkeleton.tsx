/**
 * DashboardSkeleton — loading placeholder for the GitInfo dashboard.
 * Heights vary to mimic real card content density.
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

/** Each card has a pre-generated set of line width keys. */
const SKELETON_CARDS = [
	{ key: "overview", widths: LINE_WIDTHS.slice(0, 5) },
	{ key: "status", widths: LINE_WIDTHS.slice(0, 3) },
	{ key: "branches", widths: LINE_WIDTHS.slice(0, 6) },
	{ key: "contributors", widths: LINE_WIDTHS.slice(0, 5) },
	{ key: "activity", widths: LINE_WIDTHS.slice(0, 8) },
	{ key: "files", widths: LINE_WIDTHS.slice(0, 7) },
	{ key: "tags", widths: LINE_WIDTHS.slice(0, 4) },
	{ key: "config", widths: LINE_WIDTHS.slice(2, 6) },
];

export function DashboardSkeleton() {
	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="mx-auto max-w-6xl columns-1 gap-4 md:columns-2 lg:columns-3">
				{SKELETON_CARDS.map((card) => (
					<div
						key={card.key}
						className="mb-4 break-inside-avoid animate-pulse rounded-lg border border-border bg-card p-4"
					>
						<div className="mb-3 flex items-center gap-2">
							<div className="h-4 w-4 rounded bg-muted" />
							<div className="h-4 w-20 rounded bg-muted" />
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
