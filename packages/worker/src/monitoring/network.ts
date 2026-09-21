import type {
	NetworkActivity,
	NetworkEvent,
	NetworkKind,
} from "@signoff/domain/network";

export async function recordNetwork(
	db: D1Database,
	event: NetworkEvent,
	now = Math.floor(Date.now() / 1000),
) {
	await db.batch([
		db
			.prepare(
				"INSERT OR IGNORE INTO network_requests(id,kind,at) VALUES(?,?,?)",
			)
			.bind(event.id, event.kind, event.at),
		db.prepare("DELETE FROM network_requests WHERE at < ?").bind(now - 7200),
	]);
}
export async function queryNetwork(
	db: D1Database,
	now: number,
): Promise<NetworkActivity> {
	const start = Math.floor(now / 60) * 60 - 3540;
	const { results } = await db
		.prepare(
			"SELECT (at / 60) * 60 AS minute, kind, COUNT(*) AS count FROM network_requests WHERE at >= ? AND at <= ? GROUP BY minute,kind",
		)
		.bind(start, now)
		.all<{ minute: number; kind: NetworkKind; count: number }>();
	const buckets = Array.from({ length: 60 }, (_, i) => ({
		at: start + i * 60,
		adoDiscovery: 0,
		adoDetails: 0,
		adoChecks: 0,
		jev: 0,
	}));
	for (const row of results) {
		const bucket = buckets[(row.minute - start) / 60];
		if (bucket) bucket[row.kind] = row.count;
	}
	return { asOf: now, buckets };
}
export function measuredJevFetch(
	db: D1Database,
	fetcher: typeof fetch = fetch,
): typeof fetch {
	return Object.assign(
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const event: NetworkEvent = {
				id: crypto.randomUUID(),
				kind: "jev",
				at: Math.floor(Date.now() / 1000),
			};
			try {
				return await fetcher(input, init);
			} finally {
				try {
					await recordNetwork(db, event);
				} catch {
					// biome-ignore lint/suspicious/noConsole: Operational telemetry failure without provider data
					console.warn("Could not record Jev request activity");
				}
			}
		},
		{ preconnect: fetcher.preconnect },
	);
}
