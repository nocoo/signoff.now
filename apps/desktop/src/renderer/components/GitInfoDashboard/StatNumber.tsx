/**
 * StatNumber — reusable stat display with label and optional unit.
 */

import { cn } from "@signoff/ui/utils";

interface StatNumberProps {
	label: string;
	value: number | string;
	unit?: string;
	className?: string;
}

export function StatNumber({ label, value, className }: StatNumberProps) {
	return (
		<div className={cn("flex flex-col gap-0.5", className)}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-lg font-semibold tabular-nums">{value}</span>
		</div>
	);
}

/** Format large numbers with K/M suffixes. */
export function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

/** Format KiB to human-readable size. */
export function formatSize(kiB: number): string {
	if (kiB >= 1_048_576) return `${(kiB / 1_048_576).toFixed(1)} GB`;
	if (kiB >= 1024) return `${(kiB / 1024).toFixed(1)} MB`;
	return `${kiB} KB`;
}

/** Format bytes to human-readable size. */
export function formatBytes(bytes: number): string {
	if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
	if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}

/** Format ISO date string to relative time. */
export function relativeDate(isoDate: string): string {
	const now = Date.now();
	const then = new Date(isoDate).getTime();
	const diffMs = now - then;
	const diffMins = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);
	const diffMonths = Math.floor(diffDays / 30);
	const diffYears = Math.floor(diffDays / 365);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;
	if (diffMonths < 12) return `${diffMonths}mo ago`;
	return `${diffYears}y ago`;
}
