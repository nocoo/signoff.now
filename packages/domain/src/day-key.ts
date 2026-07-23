/**
 * dayKey — calendar date in IANA timezone from UTC unix seconds.
 * Locale is en-CA (not the timezone string). Bun rejects IANA as locale.
 */

export function dayKey(occurredAtSec: number, timeZone: string): string {
	if (!Number.isFinite(occurredAtSec) || occurredAtSec <= 0) {
		throw new Error("occurredAtSec must be a positive finite number");
	}
	if (!timeZone || typeof timeZone !== "string") {
		throw new Error("timeZone required");
	}
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(occurredAtSec * 1000));

	const year = parts.find((p) => p.type === "year")?.value;
	const month = parts.find((p) => p.type === "month")?.value;
	const day = parts.find((p) => p.type === "day")?.value;
	if (!year || !month || !day) {
		throw new Error(`failed to format dayKey for timeZone=${timeZone}`);
	}
	return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
