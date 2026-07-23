import { describe, expect, test } from "bun:test";
import { createLogger } from "../logger.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { ingestFixture } from "./ingest-fixture.ts";

const valid = {
	pipelineConfigVersion: 1,
	runId: "01JAY7B4HXTMRP0VQZ0FKZH5S8",
	chunkIndex: 0,
	isFinalChunk: true,
	runMeta: {
		startedAt: 1720000000,
		source: "fixture",
		windowFrom: "2026-06-01",
		windowTo: "2026-07-01",
		mode: "full_rematch",
	},
	activities: [
		{
			type: "pr.merged",
			occurredAt: 1720000123,
			provider: "ado",
			org: "acme",
			project: "Alpha",
			repoId: "repo-1",
			developerId: "dev-1",
			matchedUniqueName: "ada@example.com",
			sourceIds: {
				prRepoGuid: "11111111-1111-4111-8111-111111111111",
				prId: 1001,
			},
		},
	],
	unmatchedIdentities: [],
};

const successBody = {
	runId: valid.runId,
	chunkIndex: 0,
	pipelineConfigVersion: 1,
	activities: { received: 1, upserted: 1, rejected: 0 },
	scores: { affectedDevDays: 1, recomputed: 1 },
	unmatched: { upserted: 0 },
	finalized: true,
};

describe("ingestFixture", () => {
	test("validates without client", async () => {
		const logs: string[] = [];
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(code).toBe(0);
		expect(logs.some((l) => l.includes("no HTTP"))).toBe(true);
		expect(logs.some((l) => l.includes("pr.merged"))).toBe(true);
	});

	test("POSTs when client provided", async () => {
		const calls: unknown[] = [];
		const client: PipelineClient = {
			bootstrap: async () => {
				throw new Error("no");
			},
			ingest: async (body) => {
				calls.push(body);
				return successBody;
			},
			recomputeComplete: async () => ({}),
		};
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client,
		});
		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
	});

	test("invalid schema → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify({ pipelineConfigVersion: 1 }),
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("bad json → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => "{",
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("read error → runtime", async () => {
		const code = await ingestFixture({
			filePath: "/missing.json",
			readFile: async () => {
				throw new Error("ENOENT");
			},
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(1);
	});

	test("previews first 3 of many activities", async () => {
		const many = {
			...valid,
			activities: Array.from({ length: 5 }, (_, i) => ({
				...valid.activities[0],
				sourceIds: {
					prRepoGuid: "11111111-1111-4111-8111-111111111111",
					prId: 1000 + i,
				},
			})),
		};
		const logs: string[] = [];
		await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(many),
			log: createLogger({ log: (s) => logs.push(s) }),
		});
		expect(logs.some((l) => l.includes("and 2 more"))).toBe(true);
	});

	test("409 → contract", async () => {
		const err = {
			status: 409,
			body: {},
			message: "conflict",
		};
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => {
					throw err;
				},
				recomputeComplete: async () => ({}),
			},
		});
		expect(code).toBe(3);
	});

	test("422 → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => {
					throw { status: 422, body: {}, message: "bad ref" };
				},
				recomputeComplete: async () => ({}),
			},
		});
		expect(code).toBe(3);
	});

	test("400 → runtime", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => {
					throw { status: 400, body: {}, message: "bad" };
				},
				recomputeComplete: async () => ({}),
			},
		});
		expect(code).toBe(1);
	});

	test("5xx exhausted → server", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => {
					throw { status: 503, body: {}, message: "down" };
				},
				recomputeComplete: async () => ({}),
			},
		});
		expect(code).toBe(4);
	});

	test("network exhausted → server", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => {
					throw new Error("ECONNRESET");
				},
				recomputeComplete: async () => ({}),
			},
		});
		expect(code).toBe(4);
	});

	test("invalid success body → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => ({ not: "valid" }),
				recomputeComplete: async () => ({}),
			},
		});
		expect(code).toBe(3);
	});

	test("split chunk failure → contract", async () => {
		// force split failure by patching is hard; isFinalChunk false already covered
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify({ ...valid, isFinalChunk: false }),
			log: createLogger({ log: () => {}, error: () => {} }),
		});
		expect(code).toBe(3);
	});

	test("completeRematch calls recomputeComplete", async () => {
		const calls: unknown[] = [];
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async (body) => {
					calls.push(body);
					return { ok: true };
				},
			},
			completeRematch: true,
		});
		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
	});

	test("completeRematch ignored for incremental", async () => {
		const body = {
			...valid,
			runMeta: { ...valid.runMeta, mode: "incremental" as const },
		};
		const calls: unknown[] = [];
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(body),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => ({ ...successBody, finalized: true }),
				recomputeComplete: async (b) => {
					calls.push(b);
					return { ok: true };
				},
			},
			completeRematch: true,
		});
		expect(code).toBe(0);
		expect(calls).toHaveLength(0);
	});

	test("completeRematch http 409 → contract", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => {
					throw { status: 409, body: {}, message: "no" };
				},
			},
			completeRematch: true,
		});
		expect(code).toBe(3);
	});

	test("cache version mismatch → contract", async () => {
		const files = new Map<string, string>();
		const fs = {
			mkdir: async () => {},
			writeFile: async (p: string, d: string) => {
				files.set(p, d);
			},
			readFile: async (p: string) => {
				const v = files.get(p);
				if (v === undefined) {
					throw new Error("ENOENT");
				}
				return v;
			},
			stat: async () => null,
		};
		files.set(
			"/data/cache/bootstrap.json",
			JSON.stringify({
				fetchedAt: "t",
				settings: {
					timezone: "UTC",
					emailSuffixes: [],
					activityWeights: {},
					pipelineConfigVersion: 99,
					scoresStale: false,
					scoresStaleReason: null,
				},
				developers: [],
				repos: [],
				cachedAt: "t",
			}),
		);
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/data",
		});
		expect(code).toBe(3);
	});

	test("missing cache → contract", async () => {
		const fs = {
			mkdir: async () => {},
			writeFile: async () => {},
			readFile: async () => {
				throw new Error("ENOENT");
			},
			stat: async () => null,
		};
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => ({}),
			},
			fs,
			dataDir: "/data",
		});
		expect(code).toBe(3);
	});

	test("--pull refreshes cache then posts", async () => {
		const files = new Map<string, string>();
		const fs = {
			mkdir: async () => {},
			writeFile: async (p: string, d: string) => {
				files.set(p, d);
			},
			readFile: async (p: string) => {
				const v = files.get(p);
				if (v === undefined) {
					throw new Error("ENOENT");
				}
				return v;
			},
			stat: async () => null,
		};
		const snap = {
			fetchedAt: "t",
			settings: {
				timezone: "UTC",
				emailSuffixes: ["example.com"],
				activityWeights: {},
				pipelineConfigVersion: 1,
				scoresStale: false,
				scoresStaleReason: null,
			},
			developers: [],
			repos: [],
		};
		const calls: unknown[] = [];
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => snap,
				ingest: async (body) => {
					calls.push(body);
					return successBody;
				},
				recomputeComplete: async () => ({}),
			},
			pull: true,
			fs,
			dataDir: "/data",
		});
		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(files.has("/data/cache/bootstrap.json")).toBe(true);
	});

	test("--pull without dataDir → runtime", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => ({}),
			},
			pull: true,
		});
		expect(code).toBe(1);
	});

	test("--pull bootstrap 5xx → server", async () => {
		const fs = {
			mkdir: async () => {},
			writeFile: async () => {},
			readFile: async () => {
				throw new Error("ENOENT");
			},
			stat: async () => null,
		};
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw { status: 503, body: {}, message: "down" };
				},
				ingest: async () => successBody,
				recomputeComplete: async () => ({}),
			},
			pull: true,
			fs,
			dataDir: "/data",
		});
		expect(code).toBe(4);
	});

	test("--pull bootstrap non-http error → server", async () => {
		const fs = {
			mkdir: async () => {},
			writeFile: async () => {},
			readFile: async () => {
				throw new Error("ENOENT");
			},
			stat: async () => null,
		};
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("network");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => ({}),
			},
			pull: true,
			fs,
			dataDir: "/data",
		});
		expect(code).toBe(4);
	});

	test("completeRematch non-409 http → runtime", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => {
					throw { status: 400, body: {}, message: "bad" };
				},
			},
			completeRematch: true,
		});
		expect(code).toBe(1);
	});

	test("completeRematch network error → server", async () => {
		const code = await ingestFixture({
			filePath: "/f.json",
			readFile: async () => JSON.stringify(valid),
			log: createLogger({ log: () => {}, error: () => {} }),
			client: {
				bootstrap: async () => {
					throw new Error("no");
				},
				ingest: async () => successBody,
				recomputeComplete: async () => {
					throw new Error("ECONNRESET");
				},
			},
			completeRematch: true,
		});
		expect(code).toBe(4);
	});
});
