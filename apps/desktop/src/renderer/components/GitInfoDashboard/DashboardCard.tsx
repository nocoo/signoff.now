/**
 * DashboardCard — shared card shell for all GitInfo dashboard cards.
 */

import { cn } from "@signoff/ui/utils";
import type { ReactNode } from "react";

interface DashboardCardProps {
	title: string;
	icon: ReactNode;
	children: ReactNode;
	className?: string;
}

export function DashboardCard({
	title,
	icon,
	children,
	className,
}: DashboardCardProps) {
	return (
		<div
			className={cn("rounded-lg border border-border bg-card p-3", className)}
		>
			<div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
				{icon}
				{title}
			</div>
			{children}
		</div>
	);
}
