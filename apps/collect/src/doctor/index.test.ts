import { describe, expect, test } from "bun:test";
import type { FsLike } from "../cache/bootstrap.ts";
import type { CollectEnv } from "../config/env.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { formatDoctor, runDoctor } from "./index.ts";

const loopbackEnv: CollectEnv = {
	apiBase: "http://127.0.0.1:37042",
	writeToken: null,
	dataDir: "/tmp/.data",
	isLoopback: true,
};

function okFs(): FsLike {
	return {
		async mkdir() {},
		async writeFile() {},
		async readFile() {
			return "";
		},
		async stat() {
			return null;
		},
	};
}

function okClient(): PipelineClient {
	return {
		bootstrap: async () =>
			({
				fetchedAt: "t",
				settings: {
					timezone: "UTC",
					emailSuffixes: [],
					activityWeights: {},
					pipelineConfigVersion: 2,
					scoresStale: false,
					scoresStaleReason: null,
				},
				developers: [],
				repos: [],
			}) as Awaited<ReturnType<PipelineClient["bootstrap"]>>,
		ingest: async () => ({}),
		recomputeComplete: async () => ({}),
	};
}

describe("runDoctor", () => {
	test("all pass on loopback", async () => {
		const r = await runDoctor({
			env: loopbackEnv,
			exec: async () => ({
				exitCode: 0,
				stdout: "{}",
				stderr: "",
			}),
			fs: okFs(),
			client: okClient(),
		});
		expect(r.ok).toBe(true);
		expect(r.checks.find((c) => c.name === "pipeline token")?.detail).toMatch(
			/loopback/,
		);
		expect(formatDoctor(r)).toMatch(/PASS/);
	});

	test("fails when az not logged in", async () => {
		const r = await runDoctor({
			env: loopbackEnv,
			exec: async () => ({
				exitCode: 1,
				stdout: "",
				stderr: "not logged in",
			}),
			fs: okFs(),
			client: okClient(),
		});
		expect(r.ok).toBe(false);
		expect(r.checks.find((c) => c.name === "az")?.ok).toBe(false);
	});

	test("requires token on remote", async () => {
		const r = await runDoctor({
			env: {
				...loopbackEnv,
				apiBase: "https://ingest.example.com",
				isLoopback: false,
				writeToken: null,
			},
			exec: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			fs: okFs(),
			client: okClient(),
		});
		expect(r.ok).toBe(false);
		expect(r.checks.find((c) => c.name === "pipeline token")?.ok).toBe(false);
	});

	test("data dir failure", async () => {
		const r = await runDoctor({
			env: loopbackEnv,
			exec: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			fs: {
				...okFs(),
				async mkdir() {
					throw new Error("EACCES");
				},
			},
			client: okClient(),
		});
		expect(r.checks.find((c) => c.name === ".data writable")?.ok).toBe(false);
	});

	test("data dir write probe failure after mkdir", async () => {
		const r = await runDoctor({
			env: loopbackEnv,
			exec: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			fs: {
				...okFs(),
				async writeFile() {
					throw new Error("EROFS");
				},
			},
			client: okClient(),
		});
		expect(r.checks.find((c) => c.name === ".data writable")?.ok).toBe(false);
		expect(r.checks.find((c) => c.name === ".data writable")?.detail).toMatch(
			/EROFS/,
		);
	});

	test("bootstrap unreachable", async () => {
		const r = await runDoctor({
			env: loopbackEnv,
			exec: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			fs: okFs(),
			client: {
				...okClient(),
				bootstrap: async () => {
					throw { status: 403, body: null, message: "HTTP 403" };
				},
			},
		});
		expect(r.checks.find((c) => c.name === "bootstrap")?.ok).toBe(false);
	});

	test("bootstrap generic error", async () => {
		const r = await runDoctor({
			env: loopbackEnv,
			exec: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			fs: okFs(),
			client: {
				...okClient(),
				bootstrap: async () => {
					throw new Error("ECONNREFUSED");
				},
			},
		});
		expect(r.checks.find((c) => c.name === "bootstrap")?.detail).toMatch(
			/ECONNREFUSED/,
		);
	});

	test("remote with token configured", async () => {
		const r = await runDoctor({
			env: {
				...loopbackEnv,
				apiBase: "https://ingest.example.com",
				isLoopback: false,
				writeToken: "secret",
			},
			exec: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
			fs: okFs(),
			client: okClient(),
		});
		expect(r.ok).toBe(true);
		expect(r.checks.find((c) => c.name === "pipeline token")?.detail).toBe(
			"configured",
		);
	});
});
