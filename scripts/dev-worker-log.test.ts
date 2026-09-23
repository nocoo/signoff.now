import { expect, test } from "bun:test";
import { formatWorkerLog } from "./dev-worker-log";

test("HTTP logs distinguish background activity, cache reads and writes", () => {
	for (const [method, path, category] of [
		["GET", "/api/live", "HEALTH"],
		["POST", "/api/collector/heartbeat", "HEARTBEAT"],
		["POST", "/api/collector/claim?lane=checks", "CLAIM"],
		["POST", "/api/collector/schedule", "SCHEDULE"],
		["POST", "/api/collector/avatars/claim", "AVATAR"],
		["POST", "/api/collector/network", "NETWORK"],
		["POST", "/api/collector/jobs/abc/progress", "TASK"],
		["POST", "/api/ai/tick", "AI"],
		["GET", "/api/query/v1/prs", "CACHE"],
		["PATCH", "/api/projects/abc", "WRITE"],
	]) {
		const output = formatWorkerLog(
			`[wrangler:info] ${method} ${path} 200 OK (3ms)`,
			false,
		);
		expect(output).toContain(
			`${category!.padEnd(10)} 200     3ms ${method!.padEnd(7)} ${path} OK`,
		);
	}
});

test("errors and slow requests remain prominent; unfamiliar diagnostics remain intact", () => {
	expect(
		formatWorkerLog(
			"[wrangler:info] POST /api/collector/claim 500 Internal Server Error (2ms)",
			false,
		),
	).toContain("CLAIM      ERROR 500");
	expect(
		formatWorkerLog(
			"[wrangler:info] POST /api/collector/claim 409 Conflict (2ms)",
			false,
		),
	).toContain("CLAIM      WARN 409");
	expect(
		formatWorkerLog(
			"[wrangler:info] GET /api/query/v1/prs 200 OK (1.2s)",
			false,
		),
	).toContain("CACHE      WARN 200");
	expect(
		formatWorkerLog(
			"[wrangler:info] GET /api/query/v1/prs 200 OK (1000ms)",
			false,
		),
	).toContain("WARN 200");
	const diagnostic = "  at execute (worker.ts:42)";
	expect(formatWorkerLog(diagnostic)).toBe(diagnostic);
	expect(
		formatWorkerLog(
			"\u001b[32m[wrangler:info] GET /api/live 200 OK (1ms)\u001b[0m",
			false,
		),
	).toContain("HEALTH");
});
