import { Empty } from "@nocoo/basalt/components/empty";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	compact = false,
	className,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	action?: React.ReactNode;
	compact?: boolean;
	className?: string;
}) {
	return (
		<Empty
			data-slot="empty-state"
			icon={
				<span className="mb-1 flex size-12 shrink-0 items-center justify-center rounded-basalt-lg bg-basalt-primary/8 text-basalt-primary ring-1 ring-inset ring-basalt-primary/10">
					<Icon className="size-8" strokeWidth={1.5} aria-hidden />
				</span>
			}
			title={title}
			description={description}
			action={action}
			className={cn(
				"w-full min-w-0 justify-center gap-3 px-6 [&>p]:max-w-sm [&>p]:text-balance [&>p]:break-words [&>p]:leading-5 [&>p:first-of-type]:font-semibold [&>div:last-child]:flex-wrap",
				compact ? "min-h-48 py-8" : "min-h-64 py-12 sm:px-8",
				className,
			)}
		/>
	);
}
