import { Empty } from "@nocoo/basalt/components/empty";
import type { LucideIcon } from "lucide-react";

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
		<Empty
			icon={<Icon className="h-12 w-12" strokeWidth={1} aria-hidden />}
			title={title}
			description={description}
			action={action}
			className={className}
		/>
	);
}
