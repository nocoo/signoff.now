import { expect, spyOn, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { createRuntimeLogger, runtimeLog } from "./runtime-log";

test("runtime logs align categories, retain severity and sanitize terminal control input", () => {
	const options = { time: new Date(2026, 8, 23, 9, 5, 1), color: false };
	expect(runtimeLog("CLAIM", "200 3ms", options)).toBe(
		"09:05:01 CLAIM      200 3ms",
	);
	expect(
		runtimeLog("CHECKS", "bad\n\u001b[31minput", {
			...options,
			level: "error",
		}),
	).toBe("09:05:01 CHECKS     ERROR bad input");
	expect(runtimeLog("AI", "slow", { ...options, level: "warn" })).toContain(
		"WARN slow",
	);
	const colored = runtimeLog("DISCOVER", "job=abc complete 10ms", {
		...options,
		color: true,
	});
	expect(colored).toContain("\u001b[");
	expect(stripVTControlCharacters(colored)).toBe(
		runtimeLog("DISCOVER", "job=abc complete 10ms", options),
	);
});

test("daemon logs identify lanes and respect NO_COLOR even when grouped startup forces color", () => {
	const noColor = process.env.NO_COLOR;
	const forceColor = process.env.FORCE_COLOR;
	const output: string[] = [];
	const write = spyOn(process.stderr, "write").mockImplementation((chunk) => {
		output.push(String(chunk));
		return true;
	});
	try {
		process.env.NO_COLOR = "1";
		process.env.FORCE_COLOR = "1";
		const log = createRuntimeLogger();
		log.info("[checks] repo #42 started");
		log.info("[discover] job=abc complete 10ms");
		log.warn("[avatars] Refresh failed");
		log.error("[ai] Inference failed");
		log.info("Watching");
		expect(
			output.every((line) => !line.includes("\u001b[") && line.endsWith("\n")),
		).toBe(true);
		expect(output[0]).toContain("CHECKS     repo #42 started");
		expect(output[1]).toContain("DISCOVER   job=abc complete 10ms");
		expect(output[2]).toContain("AVATAR     WARN Refresh failed");
		expect(output[3]).toContain("AI         ERROR Inference failed");
		expect(output[4]).toContain("COLLECTOR  Watching");
		delete process.env.NO_COLOR;
		expect(runtimeLog("HEARTBEAT", "ready")).toContain("\u001b[");
		process.env.FORCE_COLOR = "0";
		expect(runtimeLog("HEALTH", "ready")).not.toContain("\u001b[");
	} finally {
		write.mockRestore();
		if (noColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = noColor;
		if (forceColor === undefined) delete process.env.FORCE_COLOR;
		else process.env.FORCE_COLOR = forceColor;
	}
});
