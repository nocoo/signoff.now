import { describe, expect, test } from "bun:test";
import { createLogger } from "./logger.ts";

describe("createLogger", () => {
	test("routes info/warn/error", () => {
		const out: string[] = [];
		const err: string[] = [];
		const log = createLogger({
			log: (s) => out.push(s),
			error: (s) => err.push(s),
		});
		log.info("i");
		log.warn("w");
		log.error("e");
		expect(out).toEqual(["i", "warn: w"]);
		expect(err).toEqual(["error: e"]);
	});
});
