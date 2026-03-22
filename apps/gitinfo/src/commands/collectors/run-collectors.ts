import type { CollectorError } from "../types.ts";
import type { Collector, CollectorContext } from "./types.ts";

export interface CollectorResults {
	results: Map<string, unknown>;
	errors: CollectorError[];
}

export async function runCollectors(
	collectors: Collector<unknown>[],
	ctx: CollectorContext,
): Promise<CollectorResults> {
	const eligible = collectors.filter((c) => ctx.activeTiers.has(c.tier));
	const results = new Map<string, unknown>();
	const errors: CollectorError[] = [];

	const promises = eligible.map(async (collector) => {
		try {
			const result = await collector.collect(ctx);
			results.set(collector.name, result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push({
				collector: collector.name,
				message,
			});
		}
	});

	await Promise.all(promises);

	return { results, errors };
}
