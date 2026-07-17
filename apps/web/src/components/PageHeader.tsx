import { cn } from "@/lib/utils";

export function PageHeader({
	title,
	description,
	actions,
	className,
}: {
	title: string;
	description?: string;
	actions?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6",
				className,
			)}
		>
			<div className="min-w-0">
				<h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight text-foreground">
					{title}
				</h1>
				{description ? (
					<p className="mt-1 text-sm text-muted-foreground max-w-2xl">
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex flex-wrap items-center gap-2 shrink-0">
					{actions}
				</div>
			) : null}
		</div>
	);
}
