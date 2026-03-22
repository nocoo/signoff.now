import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import { createMockFsReader } from "../../executor/mock-fs-reader.ts";
import type { CollectorTier } from "../types.ts";
import { runCollectors } from "./run-collectors.ts";
import type { Collector, CollectorContext } from "./types.ts";

function createCtx(
	activeTiers: CollectorTier[] = ["instant", "moderate"],
): CollectorContext {
	return {
		exec: createMockExecutor(new Map()),
		fs: createMockFsReader(),
		repoRoot: "/repo",
		gitDir: "/repo/.git",
		gitPath: async (name: string) => `/repo/.git/${name}`,
		hasHead: true,
		activeTiers: new Set(activeTiers),
	};
}

describe("runCollectors", () => {
	it("runs eligible collectors and collects results", async () => {
		const collector: Collector<string> = {
			name: "test",
			tier: "instant",
			collect: async () => "hello",
		};
		const { results, errors } = await runCollectors([collector], createCtx());
		expect(results.get("test")).toBe("hello");
		expect(errors).toHaveLength(0);
	});

	it("skips collectors whose tier is not active", async () => {
		const collector: Collector<string> = {
			name: "slow-test",
			tier: "slow",
			collect: async () => "data",
		};
		const ctx = createCtx(["instant", "moderate"]);
		const { results } = await runCollectors([collector], ctx);
		expect(results.has("slow-test")).toBe(false);
	});

	it("isolates errors per collector", async () => {
		const good: Collector<string> = {
			name: "good",
			tier: "instant",
			collect: async () => "ok",
		};
		const bad: Collector<string> = {
			name: "bad",
			tier: "instant",
			collect: async () => {
				throw new Error("oops");
			},
		};
		const { results, errors } = await runCollectors([good, bad], createCtx());
		expect(results.get("good")).toBe("ok");
		expect(results.has("bad")).toBe(false);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.collector).toBe("bad");
		expect(errors[0]?.message).toBe("oops");
	});

	it("runs all eligible collectors in parallel", async () => {
		const order: string[] = [];
		const c1: Collector<void> = {
			name: "c1",
			tier: "instant",
			collect: async () => {
				order.push("c1");
			},
		};
		const c2: Collector<void> = {
			name: "c2",
			tier: "moderate",
			collect: async () => {
				order.push("c2");
			},
		};
		await runCollectors([c1, c2], createCtx());
		expect(order).toContain("c1");
		expect(order).toContain("c2");
	});

	it("handles non-Error throws", async () => {
		const bad: Collector<string> = {
			name: "bad",
			tier: "instant",
			collect: async () => {
				throw "string error";
			},
		};
		const { errors } = await runCollectors([bad], createCtx());
		expect(errors[0]?.message).toBe("string error");
	});

	it("includes slow collectors when slow tier is active", async () => {
		const slowCollector: Collector<string> = {
			name: "slow",
			tier: "slow",
			collect: async () => "slow-data",
		};
		const ctx = createCtx(["instant", "moderate", "slow"]);
		const { results } = await runCollectors([slowCollector], ctx);
		expect(results.get("slow")).toBe("slow-data");
	});
});
