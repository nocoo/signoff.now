import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function StatCard({
	title,
	value,
	subtitle,
	icon: Icon,
	iconClassName = "text-primary",
	to,
	className,
}: {
	title: string;
	value: string | number;
	subtitle?: string;
	icon?: LucideIcon;
	iconClassName?: string;
	to?: string;
	className?: string;
}) {
	const body = (
		<div
			className={cn(
				"rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 h-full transition-colors",
				to && "hover:bg-accent/80",
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1 min-w-0">
					<p className="text-xs md:text-sm text-muted-foreground">{title}</p>
					<p className="text-xl md:text-2xl font-semibold text-foreground font-display tracking-tight">
						{typeof value === "number" ? value.toLocaleString() : String(value)}
					</p>
					{subtitle ? (
						<p className="text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{Icon ? (
					<div className={cn("rounded-md bg-card p-2 shrink-0", iconClassName)}>
						<Icon className="h-5 w-5" strokeWidth={1.5} />
					</div>
				) : null}
			</div>
		</div>
	);

	if (to) {
		return (
			<Link
				to={to}
				className="block h-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-[var(--radius-card)]"
			>
				{body}
			</Link>
		);
	}
	return body;
}

export function StatGrid({
	children,
	columns = 4,
}: {
	children: React.ReactNode;
	columns?: 2 | 3 | 4;
}) {
	return (
		<div
			className={cn(
				"grid gap-3 md:gap-4",
				columns === 2 && "grid-cols-1 sm:grid-cols-2",
				columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
				columns === 4 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
			)}
		>
			{children}
		</div>
	);
}
