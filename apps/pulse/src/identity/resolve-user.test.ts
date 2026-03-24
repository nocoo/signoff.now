import { describe, expect, test } from "bun:test";
import { createMockExecutor } from "../executor/mock-executor.ts";
import type { MockResponse } from "../executor/types.ts";
import {
	buildIdentityMap,
	type CacheStore,
	getOrgsForUser,
	getTokenForUser,
	listGhUsers,
	parseCachedMap,
	resolveIdentity,
	serializeMap,
} from "./resolve-user.ts";
import type { IdentityMapCache } from "./types.ts";

function mockGhAuth(users: Array<{ login: string; active: boolean }>) {
	const hosts: Record<
		string,
		Array<{ login: string; active: boolean; host: string }>
	> = {
		"github.com": users.map((u) => ({
			login: u.login,
			active: u.active,
			host: "github.com",
		})),
	};
	return JSON.stringify({ hosts });
}

function mockGhAuthMultiHost(
	hostsData: Record<string, Array<{ login: string; active: boolean }>>,
) {
	const hosts: Record<
		string,
		Array<{ login: string; active: boolean; host: string }>
	> = {};
	for (const [host, users] of Object.entries(hostsData)) {
		hosts[host] = users.map((u) => ({
			login: u.login,
			active: u.active,
			host,
		}));
	}
	return JSON.stringify({ hosts });
}

describe("listGhUsers", () => {
	test("parses gh auth status output", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				[
					"gh auth status --json hosts",
					{
						stdout: mockGhAuth([
							{ login: "alice", active: true },
							{ login: "alice_work", active: false },
						]),
					},
				],
			]),
		);

		const users = await listGhUsers(exec);
		expect(users).toEqual([
			{ login: "alice", active: true, host: "github.com" },
			{ login: "alice_work", active: false, host: "github.com" },
		]);
	});

	test("parses multi-host gh auth status", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				[
					"gh auth status --json hosts",
					{
						stdout: mockGhAuthMultiHost({
							"github.com": [{ login: "alice", active: true }],
							"github.acme.com": [{ login: "alice_work", active: true }],
						}),
					},
				],
			]),
		);

		const users = await listGhUsers(exec);
		expect(users).toHaveLength(2);
		expect(users.find((u) => u.host === "github.com")?.login).toBe("alice");
		expect(users.find((u) => u.host === "github.acme.com")?.login).toBe(
			"alice_work",
		);
	});

	test("returns empty on command failure", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh auth status --json hosts", { stdout: "", exitCode: 1 }],
			]),
		);

		const users = await listGhUsers(exec);
		expect(users).toEqual([]);
	});

	test("returns empty on invalid JSON", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh auth status --json hosts", { stdout: "not json" }],
			]),
		);

		const users = await listGhUsers(exec);
		expect(users).toEqual([]);
	});
});

describe("getTokenForUser", () => {
	test("returns token on success", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh auth token --user alice", { stdout: "gho_abc123" }],
			]),
		);

		const token = await getTokenForUser(exec, "alice");
		expect(token).toBe("gho_abc123");
	});

	test("returns null on failure", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh auth token --user unknown", { stdout: "", exitCode: 1 }],
			]),
		);

		const token = await getTokenForUser(exec, "unknown");
		expect(token).toBeNull();
	});
});

describe("getOrgsForUser", () => {
	test("returns org list with --paginate", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				[
					"gh api /user/orgs --paginate --jq .[].login",
					{ stdout: "acme-corp\nacme-labs" },
				],
			]),
		);

		const orgs = await getOrgsForUser(exec, "token123");
		expect(orgs).toEqual(["acme-corp", "acme-labs"]);
	});

	test("returns empty on failure", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				[
					"gh api /user/orgs --paginate --jq .[].login",
					{ stdout: "", exitCode: 1 },
				],
			]),
		);

		const orgs = await getOrgsForUser(exec, "token123");
		expect(orgs).toEqual([]);
	});

	test("returns empty on empty output", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh api /user/orgs --paginate --jq .[].login", { stdout: "" }],
			]),
		);

		const orgs = await getOrgsForUser(exec, "token123");
		expect(orgs).toEqual([]);
	});
});

describe("buildIdentityMap", () => {
	test("builds host-scoped map with direct users and orgs", async () => {
		const callCount = { orgCalls: 0 };
		const responses = new Map<string, MockResponse>([
			[
				"gh auth status --json hosts",
				{
					stdout: mockGhAuth([
						{ login: "alice", active: true },
						{ login: "alice_work", active: false },
					]),
				},
			],
			["gh auth token --user alice", { stdout: "token_alice" }],
			["gh auth token --user alice_work", { stdout: "token_work" }],
		]);

		// Custom executor that returns different orgs based on GH_TOKEN env
		const exec: import("../executor/types.ts").CommandExecutor = async (
			cmd,
			args,
			opts,
		) => {
			const key = [cmd, ...args].join(" ");
			if (key === "gh api /user/orgs --paginate --jq .[].login") {
				callCount.orgCalls++;
				if (opts?.env?.GH_TOKEN === "token_alice") {
					return { stdout: "", stderr: "", exitCode: 0 };
				}
				if (opts?.env?.GH_TOKEN === "token_work") {
					return { stdout: "acme-corp", stderr: "", exitCode: 0 };
				}
			}
			const match = responses.get(key);
			if (!match) throw new Error(`No mock for: ${key}`);
			return {
				stdout: match.stdout,
				stderr: match.stderr ?? "",
				exitCode: match.exitCode ?? 0,
			};
		};

		const map = await buildIdentityMap(exec);
		// Keys are host-scoped: "github.com\0owner"
		expect(map.get("github.com\0alice")).toBe("alice");
		expect(map.get("github.com\0alice_work")).toBe("alice_work");
		expect(map.get("github.com\0acme-corp")).toBe("alice_work");
		expect(callCount.orgCalls).toBe(2);
	});

	test("handles user with no orgs", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				[
					"gh auth status --json hosts",
					{
						stdout: mockGhAuth([{ login: "alice", active: true }]),
					},
				],
				["gh auth token --user alice", { stdout: "token_alice" }],
				["gh api /user/orgs --paginate --jq .[].login", { stdout: "" }],
			]),
		);

		const map = await buildIdentityMap(exec);
		expect(map.get("github.com\0alice")).toBe("alice");
		expect(map.size).toBe(1);
	});

	test("handles no authenticated users", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh auth status --json hosts", { stdout: "", exitCode: 1 }],
			]),
		);

		const map = await buildIdentityMap(exec);
		expect(map.size).toBe(0);
	});

	test("scopes entries to their host", async () => {
		const responses = new Map<string, MockResponse>([
			[
				"gh auth status --json hosts",
				{
					stdout: mockGhAuthMultiHost({
						"github.com": [{ login: "alice", active: true }],
						"github.acme.com": [{ login: "alice_work", active: true }],
					}),
				},
			],
			["gh auth token --user alice", { stdout: "token_alice" }],
			["gh auth token --user alice_work", { stdout: "token_work" }],
		]);

		const exec: import("../executor/types.ts").CommandExecutor = async (
			cmd,
			args,
			opts,
		) => {
			const key = [cmd, ...args].join(" ");
			if (key === "gh api /user/orgs --paginate --jq .[].login") {
				if (opts?.env?.GH_TOKEN === "token_alice") {
					return { stdout: "shared-org", stderr: "", exitCode: 0 };
				}
				if (opts?.env?.GH_TOKEN === "token_work") {
					return { stdout: "shared-org", stderr: "", exitCode: 0 };
				}
			}
			const match = responses.get(key);
			if (!match) throw new Error(`No mock for: ${key}`);
			return {
				stdout: match.stdout,
				stderr: match.stderr ?? "",
				exitCode: match.exitCode ?? 0,
			};
		};

		const map = await buildIdentityMap(exec);
		// Same org name on different hosts maps to different users
		expect(map.get("github.com\0shared-org")).toBe("alice");
		expect(map.get("github.acme.com\0shared-org")).toBe("alice_work");
	});
});

describe("resolveIdentity", () => {
	function makeExec(): import("../executor/types.ts").CommandExecutor {
		const responses = new Map<string, MockResponse>([
			[
				"gh auth status --json hosts",
				{
					stdout: mockGhAuth([
						{ login: "alice", active: true },
						{ login: "alice_work", active: false },
					]),
				},
			],
			["gh auth token --user alice", { stdout: "token_alice" }],
			["gh auth token --user alice_work", { stdout: "token_work" }],
		]);

		return async (cmd, args, opts) => {
			const key = [cmd, ...args].join(" ");
			if (key === "gh api /user/orgs --paginate --jq .[].login") {
				if (opts?.env?.GH_TOKEN === "token_alice") {
					return { stdout: "", stderr: "", exitCode: 0 };
				}
				if (opts?.env?.GH_TOKEN === "token_work") {
					return { stdout: "acme-corp", stderr: "", exitCode: 0 };
				}
			}
			const match = responses.get(key);
			if (!match) throw new Error(`No mock for: ${key}`);
			return {
				stdout: match.stdout,
				stderr: match.stderr ?? "",
				exitCode: match.exitCode ?? 0,
			};
		};
	}

	test("resolves direct user match", async () => {
		const result = await resolveIdentity(makeExec(), "github.com", "alice", {
			noCache: true,
		});
		expect(result).toEqual({
			login: "alice",
			token: "token_alice",
			resolvedVia: "direct",
		});
	});

	test("resolves org match", async () => {
		const result = await resolveIdentity(
			makeExec(),
			"github.com",
			"acme-corp",
			{ noCache: true },
		);
		expect(result).toEqual({
			login: "alice_work",
			token: "token_work",
			resolvedVia: "org",
		});
	});

	test("falls back to active user for unknown owner", async () => {
		const result = await resolveIdentity(makeExec(), "github.com", "stranger", {
			noCache: true,
		});
		expect(result).toEqual({
			login: "alice",
			token: "token_alice",
			resolvedVia: "fallback",
		});
	});

	test("returns null when no users authenticated", async () => {
		const exec = createMockExecutor(
			new Map<string, MockResponse>([
				["gh auth status --json hosts", { stdout: "", exitCode: 1 }],
			]),
		);

		const result = await resolveIdentity(exec, "github.com", "alice", {
			noCache: true,
		});
		expect(result).toBeNull();
	});
});

describe("parseCachedMap", () => {
	test("returns map from valid cache with host-scoped keys", () => {
		const cache: IdentityMapCache = {
			entries: [
				{ host: "github.com", owner: "alice", ghUser: "alice" },
				{ host: "github.com", owner: "acme-corp", ghUser: "alice_work" },
			],
			createdAt: new Date().toISOString(),
		};

		const map = parseCachedMap(cache);
		expect(map?.get("github.com\0alice")).toBe("alice");
		expect(map?.get("github.com\0acme-corp")).toBe("alice_work");
	});

	test("returns null for null input", () => {
		expect(parseCachedMap(null)).toBeNull();
	});

	test("returns null for expired cache", () => {
		const cache: IdentityMapCache = {
			entries: [{ host: "github.com", owner: "alice", ghUser: "alice" }],
			createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
		};

		expect(parseCachedMap(cache)).toBeNull();
	});

	test("returns map for cache within TTL", () => {
		const cache: IdentityMapCache = {
			entries: [{ host: "github.com", owner: "alice", ghUser: "alice" }],
			createdAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
		};

		const map = parseCachedMap(cache);
		expect(map?.get("github.com\0alice")).toBe("alice");
	});
});

describe("serializeMap", () => {
	test("serializes map to cache format with host field", () => {
		const map = new Map([
			["github.com\0alice", "alice"],
			["github.com\0acme-corp", "alice_work"],
		]);

		const cache = serializeMap(map);
		expect(cache.entries).toEqual([
			{ host: "github.com", owner: "alice", ghUser: "alice" },
			{ host: "github.com", owner: "acme-corp", ghUser: "alice_work" },
		]);
		expect(cache.createdAt).toBeDefined();
	});

	test("serializes empty map", () => {
		const cache = serializeMap(new Map());
		expect(cache.entries).toEqual([]);
	});

	test("handles multi-host entries", () => {
		const map = new Map([
			["github.com\0org-x", "alice"],
			["github.acme.com\0org-x", "alice_work"],
		]);

		const cache = serializeMap(map);
		expect(cache.entries).toContainEqual({
			host: "github.com",
			owner: "org-x",
			ghUser: "alice",
		});
		expect(cache.entries).toContainEqual({
			host: "github.acme.com",
			owner: "org-x",
			ghUser: "alice_work",
		});
	});
});

describe("resolveIdentity with cache", () => {
	function makeExec(): import("../executor/types.ts").CommandExecutor {
		const responses = new Map<string, MockResponse>([
			[
				"gh auth status --json hosts",
				{
					stdout: mockGhAuth([
						{ login: "alice", active: true },
						{ login: "alice_work", active: false },
					]),
				},
			],
			["gh auth token --user alice", { stdout: "token_alice" }],
			["gh auth token --user alice_work", { stdout: "token_work" }],
		]);

		return async (cmd, args, opts) => {
			const key = [cmd, ...args].join(" ");
			if (key === "gh api /user/orgs --paginate --jq .[].login") {
				if (opts?.env?.GH_TOKEN === "token_alice") {
					return { stdout: "", stderr: "", exitCode: 0 };
				}
				if (opts?.env?.GH_TOKEN === "token_work") {
					return { stdout: "acme-corp", stderr: "", exitCode: 0 };
				}
			}
			const match = responses.get(key);
			if (!match) throw new Error(`No mock for: ${key}`);
			return {
				stdout: match.stdout,
				stderr: match.stderr ?? "",
				exitCode: match.exitCode ?? 0,
			};
		};
	}

	test("uses cached map when available", async () => {
		const mockCache: CacheStore = {
			read: async () => ({
				entries: [
					{ host: "github.com", owner: "alice", ghUser: "alice" },
					{
						host: "github.com",
						owner: "cached-org",
						ghUser: "alice_work",
					},
				],
				createdAt: new Date().toISOString(),
			}),
			write: async () => {},
		};

		const result = await resolveIdentity(
			makeExec(),
			"github.com",
			"cached-org",
			{ cacheStore: mockCache },
		);
		expect(result).toEqual({
			login: "alice_work",
			token: "token_work",
			resolvedVia: "org",
		});
	});

	test("builds fresh map and writes cache on miss", async () => {
		let writtenCache: IdentityMapCache | null = null;
		const mockCache: CacheStore = {
			read: async () => null,
			write: async (cache) => {
				writtenCache = cache;
			},
		};

		await resolveIdentity(makeExec(), "github.com", "alice", {
			cacheStore: mockCache,
		});
		expect(writtenCache).not.toBeNull();
		expect(writtenCache!.entries.length).toBeGreaterThan(0);
		// Cache entries should include host field
		expect(writtenCache!.entries[0]?.host).toBe("github.com");
	});

	test("skips cache read when noCache is true", async () => {
		let readCalled = false;
		const mockCache: CacheStore = {
			read: async () => {
				readCalled = true;
				return null;
			},
			write: async () => {},
		};

		await resolveIdentity(makeExec(), "github.com", "alice", {
			noCache: true,
			cacheStore: mockCache,
		});
		expect(readCalled).toBe(false);
	});
});
