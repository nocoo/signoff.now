import {
	StatCard as BasaltStatCard,
	StatGrid,
} from "@nocoo/basalt/charts/stat-card";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";

export function StatCard({
	title,
	value,
	subtitle,
	icon,
	iconClassName = "text-basalt-primary",
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
	const card = (
		<BasaltStatCard
			title={title}
			value={value}
			subtitle={subtitle}
			icon={icon}
			iconColor={iconClassName}
			className={className}
		/>
	);

	return to ? (
		<Link
			to={to}
			className="block h-full rounded-basalt-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-basalt-ring"
		>
			{card}
		</Link>
	) : (
		card
	);
}

export { StatGrid };
