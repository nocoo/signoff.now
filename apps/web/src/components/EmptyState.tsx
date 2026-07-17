import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center py-16 md:py-20 text-center",
				className,
			)}
		>
			<Icon
				className="h-12 w-12 text-muted-foreground/50 mb-4"
				strokeWidth={1}
				aria-hidden
			/>
			<h2 className="text-lg font-semibold text-foreground">{title}</h2>
			{description ? (
				<p className="mt-1 max-w-md text-sm text-muted-foreground">
					{description}
				</p>
			) : null}
			{action ? <div className="mt-4">{action}</div> : null}
		</div>
	);
}
