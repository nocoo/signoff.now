export function relativeAge(timestamp: number, now: number): string {
	const seconds = Math.max(0, now - timestamp);
	if (seconds < 60) return "< 1 min ago";
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86400) {
		const hours = Math.floor(seconds / 3600);
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	const days = Math.floor(seconds / 86400);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function calculationFreshness(
	timestamp: number | null,
	now: number,
): "fresh" | "warning" | "stale" | "never" {
	if (timestamp === null) return "never";
	const age = now - timestamp;
	if (age > 72 * 3600) return "stale";
	return age > 24 * 3600 ? "warning" : "fresh";
}
