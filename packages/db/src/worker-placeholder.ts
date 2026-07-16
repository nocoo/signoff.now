/**
 * Minimal Worker entry so wrangler.toml has a valid `main`.
 * Real API/SPA worker will replace this (see future architecture docs).
 */
export default {
	async fetch(): Promise<globalThis.Response> {
		return new globalThis.Response(
			"signoff.now db package — worker placeholder",
			{
				status: 200,
				headers: { "content-type": "text/plain; charset=utf-8" },
			},
		);
	},
};
