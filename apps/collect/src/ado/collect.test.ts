import { describe, expect, test } from "bun:test";
import type { FsLike } from "../cache/bootstrap.ts";
import type { AdoClient } from "./client.ts";
import { type CollectRepo, collect } from "./collect.ts";
import { createRawWriter } from "./storage.ts";

const REPO_GUID = "11111111-1111-4111-8111-111111111111";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const NOW = Math.floor(Date.parse("2026-07-26T12:00:00Z") / 1000);

const repo: CollectRepo = {
	id: "01K0REPO00000000000000000",
	org: "acme",
	project: "Alpha",
	name: "alpha-repo",
	externalId: REPO_GUID,
	projectExternalId: PROJ_GUID,
};

function memoryFs() {
	const files = new Map<string, string>();
	const fs: FsLike = {
		async mkdir() {},
		async writeFile(path, data) {
			files.set(path, data);
		},
		async rename(from, to) {
			const v = files.get(from);
			files.delete(from);
			files.set(to, v as string);
		},
		async readFile(path) {
			const v = files.get(path);
			if (v === undefined) {
				throw new Error(`no such file: ${path}`);
			}
			return v;
		},
		async stat(path) {
			return files.has(path) ? { isDirectory: false } : null;
		},
		async unlink(path) {
			files.delete(path);
		},
	};
	return { fs, files };
}

const pr = (id: number, over: Record<string, unknown> = {}) => ({
	pullRequestId: id,
	status: "completed",
	creationDate: "2026-07-01T00:00:00Z",
	closedDate: "2026-07-05T00:00:00Z",
	lastMergeCommit: { commitId: "abc" },
	createdBy: { id: "aid", uniqueName: "ada@example.com" },
	repository: { id: REPO_GUID, project: { id: PROJ_GUID } },
	...over,
});

/** Routes by URL shape so a test only scripts what it cares about. */
function routedClient(routes: {
	prs?: (status: string) => unknown;
	threads?: unknown;
	iterations?: unknown;
	wiqlIds?: number[];
	workItem?: unknown;
	updates?: unknown;
	states?: unknown;
}): AdoClient {
	return {
		async get(url) {
			if (url.includes("/pullrequests")) {
				const status =
					/searchCriteria\.status=(\w+)/.exec(url)?.[1] ?? "completed";
				return routes.prs?.(status) ?? { value: [] };
			}
			if (url.includes("/threads")) {
				return routes.threads ?? { value: [] };
			}
			if (url.includes("/iterations")) {
				return routes.iterations ?? { value: [] };
			}
			if (url.includes("/workitemtypes/")) {
				return routes.states ?? { value: [] };
			}
			if (url.includes("/updates")) {
				return routes.updates ?? { value: [] };
			}
			if (url.includes("/workitems/")) {
				return routes.workItem ?? { id: 1, fields: {} };
			}
			return { value: [] };
		},
		async post() {
			return { workItems: (routes.wiqlIds ?? []).map((id) => ({ id })) };
		},
		invalidateToken() {},
	};
}

function baseOpts(client: AdoClient, fs: FsLike) {
	return {
		client,
		fs,
		writer: createRawWriter(fs, ".data"),
		dataDir: ".data",
		collectRunId: "01JCOLLECT000000000000000",
		nowSeconds: NOW,
		repos: [repo],
		developers: [{ id: "01K0DEV000000000000000000", alias: "ada" }],
		settings: { emailSuffixes: ["example.com"] },
		includeWorkItems: false,
	};
}

describe("collect", () => {
	test("writes a manifest whose scopes are all pending", async () => {
		const { fs, files } = memoryFs();
		const client = routedClient({
			prs: (s) => ({ value: s === "completed" ? [pr(1001)] : [] }),
		});

		const { manifest, manifestPath } = await collect(baseOpts(client, fs));

		expect(manifest.scopes).toHaveLength(1);
		// Collection cannot know whether the data reached D1, so it must not
		// pre-declare success (07 §7.1.2).
		expect(manifest.scopes[0]?.status).toBe("pending");
		expect(manifest.scopes[0]?.artifacts[0]?.status).toBe("pending");
		expect(files.has(manifestPath)).toBe(true);
	});

	test("never writes the cursor", async () => {
		const { fs, files } = memoryFs();
		const client = routedClient({
			prs: (s) => ({ value: s === "completed" ? [pr(1001)] : [] }),
		});
		await collect(baseOpts(client, fs));
		// Advancing here would claim data landed that may never be ingested.
		expect(files.has(".data/meta/cursor.json")).toBe(false);
	});

	test("captures the window before fetching, ending short of now", async () => {
		const { fs } = memoryFs();
		const { manifest } = await collect(baseOpts(routedClient({}), fs));
		expect(manifest.scopes[0]?.watermark).toBe("2026-07-26T11:55:00.000Z");
	});

	test("a run starting after the cursor is marked ineligible", async () => {
		const { fs } = memoryFs();
		await fs.writeFile(
			".data/meta/cursor.json",
			JSON.stringify({
				schemaVersion: 1,
				byRepo: { [repo.id]: { prsClosedThrough: "2026-07-01T00:00:00.000Z" } },
				byProject: {},
			}),
		);
		const { manifest } = await collect({
			...baseOpts(routedClient({}), fs),
			since: "2026-07-20T00:00:00.000Z",
		});
		// Committing this watermark would skip Jul 1–20 with nothing to show it.
		expect(manifest.scopes[0]?.commitEligible).toBe(false);
	});

	test("a normal incremental run reaches back before the cursor", async () => {
		const { fs } = memoryFs();
		await fs.writeFile(
			".data/meta/cursor.json",
			JSON.stringify({
				schemaVersion: 1,
				byRepo: { [repo.id]: { prsClosedThrough: "2026-07-20T00:00:00.000Z" } },
				byProject: {},
			}),
		);
		const { manifest } = await collect(baseOpts(routedClient({}), fs));
		expect(manifest.scopes[0]?.from).toBe("2026-07-19T23:00:00.000Z");
		expect(manifest.scopes[0]?.commitEligible).toBe(true);
	});

	test("a corrupt cursor collects everything rather than skipping history", async () => {
		const { fs } = memoryFs();
		await fs.writeFile(".data/meta/cursor.json", "{ not json");
		const { manifest } = await collect(baseOpts(routedClient({}), fs));
		expect(manifest.scopes[0]?.baseCursor).toBeNull();
		expect(manifest.scopes[0]?.from).toBeNull();
	});

	test("snapshots every fetched entity", async () => {
		const { fs, files } = memoryFs();
		const client = routedClient({
			prs: (s) => ({ value: s === "completed" ? [pr(1001)] : [] }),
		});
		await collect(baseOpts(client, fs));
		const paths = [...files.keys()];
		expect(paths.some((p) => p.includes("/prs/1001/"))).toBe(true);
		expect(paths.some((p) => p.includes("/pr-threads/1001/"))).toBe(true);
		expect(paths.some((p) => p.includes("/pr-iterations/1001/"))).toBe(true);
	});

	test("an anomaly makes the scope incomplete and drops its artifact", async () => {
		const { fs } = memoryFs();
		// Completed with no merge commit: an assumption violation, not a
		// throwaway record (07 §6.4 rule 4).
		const client = routedClient({
			prs: (s) => ({
				value:
					s === "completed" ? [pr(1001, { lastMergeCommit: undefined })] : [],
			}),
		});
		const { manifest } = await collect(baseOpts(client, fs));
		const scope = manifest.scopes[0];
		expect(scope?.status).toBe("incomplete");
		expect(scope?.artifacts).toHaveLength(0);
		expect(scope?.errors[0]).toContain("lastMergeCommit");
	});

	test("a pagination problem also poisons the scope", async () => {
		const { fs } = memoryFs();
		const full = {
			value: Array.from({ length: 100 }, (_, i) =>
				pr(2000 - i, { closedDate: "2026-07-10T00:00:00Z" }),
			),
		};
		const shifted = { value: [pr(1, { closedDate: "2026-07-25T00:00:00Z" })] };
		let call = 0;
		const client: AdoClient = {
			async get(url) {
				if (url.includes("/pullrequests")) {
					call++;
					return call === 1 ? full : shifted;
				}
				return { value: [] };
			},
			async post() {
				return { workItems: [] };
			},
			invalidateToken() {},
		};
		const { manifest } = await collect(baseOpts(client, fs));
		expect(manifest.scopes[0]?.status).toBe("incomplete");
	});

	test("the artifact carries activities and the unmatched report", async () => {
		const { fs, files } = memoryFs();
		const client = routedClient({
			prs: (s) => ({
				value:
					s === "completed"
						? [
								pr(1001),
								pr(1002, { createdBy: { uniqueName: "bob@example.com" } }),
							]
						: [],
			}),
		});
		const { manifest } = await collect(baseOpts(client, fs));
		const path = manifest.scopes[0]?.artifacts[0]?.path as string;
		const body = JSON.parse(files.get(path) as string);
		expect(body.activities.length).toBeGreaterThan(0);
		// One unknown person, reported once...
		expect(body.unmatched).toHaveLength(1);
		expect(body.unmatched[0].uniqueName).toBe("bob@example.com");
		// ...but counted per dropped event (created + merged for that PR).
		expect(body.skipped.unmatched).toBe(2);
	});

	test("work items are collected once per project, not once per repo", async () => {
		const { fs } = memoryFs();
		const client = routedClient({
			wiqlIds: [7],
			workItem: {
				id: 7,
				fields: {
					"System.WorkItemType": "Bug",
					"System.CreatedDate": "2026-07-02T00:00:00Z",
					"System.CreatedBy": { uniqueName: "ada@example.com", id: "a" },
				},
			},
			states: { value: [{ name: "Done", category: "Completed" }] },
		});
		const { manifest } = await collect({
			...baseOpts(client, fs),
			includeWorkItems: true,
			// Two repos sharing one project must not fetch the items twice.
			repos: [repo, { ...repo, id: "01K0REPO2", name: "beta-repo" }],
		});
		const projectScopes = manifest.scopes.filter((s) => s.kind === "project");
		expect(projectScopes).toHaveLength(1);
	});

	test("a work item anomaly makes the project scope incomplete", async () => {
		const { fs } = memoryFs();
		const client = routedClient({
			wiqlIds: [7],
			workItem: {
				id: 7,
				fields: {
					"System.WorkItemType": "Bug",
					"System.CreatedDate": "2026-07-02T00:00:00Z",
					"System.CreatedBy": { uniqueName: "ada@example.com", id: "a" },
				},
			},
			// Two records for one rev, both with field diffs and disagreeing —
			// the transform refuses to guess which one the revision was.
			updates: {
				value: [
					{
						id: 1,
						rev: 4,
						revisedDate: "2026-07-03T00:00:00Z",
						revisedBy: { uniqueName: "ada@example.com", id: "a" },
						fields: { "System.State": { newValue: "Done" } },
					},
					{
						id: 2,
						rev: 4,
						revisedDate: "2026-07-04T00:00:00Z",
						revisedBy: { uniqueName: "ada@example.com", id: "a" },
						fields: { "System.Title": { newValue: "x" } },
					},
				],
			},
			states: { value: [{ name: "Done", category: "Completed" }] },
		});
		const { manifest } = await collect({
			...baseOpts(client, fs),
			includeWorkItems: true,
		});
		const projectScope = manifest.scopes.find((s) => s.kind === "project");
		expect(projectScope?.status).toBe("incomplete");
		expect(projectScope?.artifacts).toHaveLength(0);
	});

	test("--full ignores the cursor and stays eligible", async () => {
		const { fs } = memoryFs();
		await fs.writeFile(
			".data/meta/cursor.json",
			JSON.stringify({
				schemaVersion: 1,
				byRepo: { [repo.id]: { prsClosedThrough: "2026-07-20T00:00:00.000Z" } },
				byProject: {},
			}),
		);
		const { manifest } = await collect({
			...baseOpts(routedClient({}), fs),
			full: true,
		});
		expect(manifest.scopes[0]?.from).toBeNull();
		expect(manifest.scopes[0]?.commitEligible).toBe(true);
	});

	test("warns when a scope cannot advance the cursor", async () => {
		const { fs } = memoryFs();
		const warnings: string[] = [];
		await fs.writeFile(
			".data/meta/cursor.json",
			JSON.stringify({
				schemaVersion: 1,
				byRepo: { [repo.id]: { prsClosedThrough: "2026-07-01T00:00:00.000Z" } },
				byProject: {},
			}),
		);
		await collect({
			...baseOpts(routedClient({}), fs),
			since: "2026-07-20T00:00:00.000Z",
			log: { info: () => {}, warn: (m) => warnings.push(m) },
		});
		expect(warnings.some((w) => w.includes("will not advance"))).toBe(true);
	});
});
