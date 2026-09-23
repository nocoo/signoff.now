import { stripVTControlCharacters } from "node:util";
import { type LogCategory, runtimeLog } from "../apps/collect/src/runtime-log";

export function formatWorkerLog(line: string, color?: boolean): string {
	const match =
		/^\[wrangler:info\] (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (\S+) (\d{3}) (.*?) \((\d+(?:\.\d+)?)(ms|s)\)$/.exec(
			stripVTControlCharacters(line),
		);
	if (!match) return line;
	const [
		,
		method = "",
		path = "",
		status = "",
		statusText,
		duration = "0",
		unit,
	] = match;
	let category: LogCategory = "API";
	if (path === "/api/live") category = "HEALTH";
	else if (path === "/api/collector/heartbeat") category = "HEARTBEAT";
	else if (path === "/api/collector/schedule") category = "SCHEDULE";
	else if (path.startsWith("/api/collector/avatars/")) category = "AVATAR";
	else if (path.startsWith("/api/collector/claim")) category = "CLAIM";
	else if (path === "/api/collector/network") category = "NETWORK";
	else if (path.startsWith("/api/collector/jobs/")) category = "TASK";
	else if (path.startsWith("/api/ai/")) category = "AI";
	else if (method === "GET") category = "CACHE";
	else category = "WRITE";
	const elapsed = Number(duration) * (unit === "s" ? 1000 : 1);
	const level =
		Number(status) >= 500
			? "error"
			: Number(status) >= 400 || elapsed >= 1000
				? "warn"
				: "info";
	return runtimeLog(
		category,
		`${status} ${(duration + unit).padStart(7)} ${method.padEnd(7)} ${path} ${statusText}`,
		{ color, level },
	);
}
