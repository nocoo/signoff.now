/**
 * DashboardSkeleton — loading placeholder for the tabbed GitInfo dashboard.
 * Shows a fake tab bar + skeleton content cards in a single column.
 */

const SKELETON_TABS = [
	{ key: "overview", width: "w-20" },
	{ key: "contributors", width: "w-24" },
	{ key: "activity", width: "w-16" },
	{ key: "branches", width: "w-20" },
	{ key: "files", width: "w-14" },
	{ key: "tags", width: "w-12" },
];

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
		<div className="flex h-full flex-col overflow-hidden">
			{/* Fake tab bar */}
			<div className="shrink-0 border-b border-border px-6 pt-4">
				<div className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-[3px]">
					{SKELETON_TABS.map((tab) => (
						<div
							key={tab.key}
							className={`h-7 animate-pulse rounded-md bg-muted-foreground/10 ${tab.width}`}
						/>
					))}
				</div>
			</div>

			{/* Fake content area */}
			<div className="flex-1 overflow-y-auto p-6">
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
		</div>
	);
}
