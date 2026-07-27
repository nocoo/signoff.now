import { describe, expect, test } from "bun:test";
import { AdoError } from "../ado/client.ts";
import type { CollectOptions, CollectResult } from "../ado/collect.ts";
import type { FsLike } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import { type RunCollectDeps, runCollect } from "./run-collect.ts";

const REPO_ID = "01K0REPO00000000000000000";
const PROJ_GUID = "22222222-2222-4222-8222-222222222222";
const REPO_GUID = "11111111-1111-4111-8111-111111111111";

const bootstrapRepo = (over: Record<string, unknown> = {}) => ({
	id: REPO_ID,
	provider: "ado",
	org: "acme",
	project: "Alpha",
	name: "alpha-repo",
	externalId: REPO_GUID,
	projectExternalId: PROJ_GUID,
	enabled: true,
	...over,
});

const snapshot = (over: Record<string, unknown> = {}) => ({
	settings: { emailSuffixes: ["example.com"], pipelineConfigVersion: 1 },
	developers: [{ id: "01K0DEV000000000000000000", alias: "ada" }],
	repos: [bootstrapRepo()],
	...over,
});

const emptyResult = (): CollectResult => ({
	manifest: {
		schemaVersion: 1,
		collectRunId: "01JCLECT00000000000000000J",
		startedAt: 1_784_737_800,
		scopes: [],
	},
	manifestPath: ".data/meta/runs/x.json",
});

const noopFs = {} as FsLike;

/** Records what actually reached the collector, and whether it ran at all. */
function harness(over: Partial<RunCollectDeps> = {}) {
	const errors: string[] = [];
	const infos: string[] = [];
	const seen: CollectOptions[] = [];
	let bootstrapped = 0;

	const deps: RunCollectDeps = {
		flags: {},
		client: {
			async bootstrap() {
				bootstrapped++;
				return snapshot() as never;
			},
		},
		fs: noopFs,
		dataDir: ".data",
		log: {
			info: (m: string) => infos.push(m),
			warn: () => {},
			error: (m: string) => errors.push(m),
		},
		nowSeconds: 1_784_737_800,
		collectRunId: "01JCLECT00000000000000000J",
		async collect(opts) {
			seen.push(opts);
			return emptyResult();
		},
		makeAdoClient: () => ({}) as CollectOptions["client"],
		makeWriter: () => ({}) as CollectOptions["writer"],
		...over,
	};
	return {
		deps,
		errors,
		infos,
		seen,
		bootstrapCount: () => bootstrapped,
	};
}

describe("runCollect flag guards", () => {
	test("--full --repo is refused BEFORE any network call", async () => {
		// The guard's placement is the point: a bad combination must fail
		// instantly, not after a bootstrap that might fail first and mask it.
		const h = harness({ flags: { full: true, repo: REPO_ID } });
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
		expect(h.bootstrapCount()).toBe(0);
		expect(h.seen).toHaveLength(0);
		expect(h.errors[0]).toMatch(/--full/);
	});

	test("--full --no-wi is refused BEFORE any network call", async () => {
		const h = harness({ flags: { full: true, wi: false } });
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
		expect(h.bootstrapCount()).toBe(0);
		expect(h.seen).toHaveLength(0);
		expect(h.errors[0]).toMatch(/work items/);
	});

	test("a valid --full run reaches the collector", async () => {
		const h = harness({ flags: { full: true } });
		expect(await runCollect(h.deps)).toBe(ExitCode.OK);
		expect(h.seen[0]?.full).toBe(true);
		expect(h.infos.some((m) => m.includes("full rematch"))).toBe(true);
	});
});

describe("runCollect error mapping", () => {
	test("an AdoError from the collector keeps its exit code", async () => {
		// Collapsing this to RUNTIME would tell automation that an expired login
		// is a programming bug.
		const h = harness({
			async collect() {
				throw new AdoError("unauthenticated", "run `az login`");
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.ENV);
		expect(h.errors[0]).toMatch(/az login/);
	});

	test("a rate limit maps to SERVER, not ENV", async () => {
		const h = harness({
			async collect() {
				throw new AdoError("rate_limited", "slow down");
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.SERVER);
	});

	test("a bootstrap failure is mapped too, not just the collect call", async () => {
		const h = harness({
			client: {
				async bootstrap() {
					throw new AdoError("server", "worker down");
				},
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.SERVER);
	});

	test("a plain Error is still RUNTIME", async () => {
		const h = harness({
			async collect() {
				throw new Error("boom");
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.RUNTIME);
	});
});

describe("runCollect repo selection", () => {
	test("passes the enabled ADO repos through to the collector", async () => {
		const h = harness();
		expect(await runCollect(h.deps)).toBe(ExitCode.OK);
		expect(h.seen[0]?.repos).toHaveLength(1);
		expect(h.seen[0]?.repos[0]?.externalId).toBe(REPO_GUID);
		expect(h.seen[0]?.settings.emailSuffixes).toEqual(["example.com"]);
	});

	test("--repo narrows to one binding", async () => {
		const h = harness({
			flags: { repo: REPO_ID },
			client: {
				async bootstrap() {
					return snapshot({
						repos: [
							bootstrapRepo(),
							bootstrapRepo({ id: "01K0OTHER0000000000000000" }),
						],
					}) as never;
				},
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.OK);
		expect(h.seen[0]?.repos.map((r) => r.id)).toEqual([REPO_ID]);
	});

	test("a repo id that matches nothing is a contract error", async () => {
		const h = harness({ flags: { repo: "01K0MISSING00000000000000" } });
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
		expect(h.errors[0]).toMatch(/01K0MISSING00000000000000/);
		expect(h.seen).toHaveLength(0);
	});

	test("no bound repos points at the web UI rather than failing blankly", async () => {
		const h = harness({
			client: {
				async bootstrap() {
					return snapshot({ repos: [] }) as never;
				},
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
		expect(h.errors[0]).toMatch(/web UI/);
	});

	test("a non-ADO or GUID-less repo is not collectable", async () => {
		const h = harness({
			client: {
				async bootstrap() {
					return snapshot({
						repos: [
							bootstrapRepo({ provider: "github" }),
							bootstrapRepo({
								id: "01K0NOGUID0000000000000000",
								externalId: null,
							}),
						],
					}) as never;
				},
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
		expect(h.seen).toHaveLength(0);
	});

	test("a repo missing its project GUID stops the run", async () => {
		// Work items are project-scoped; without the GUID the server rejects
		// their activities, so collecting them would waste a whole pass.
		const h = harness({
			client: {
				async bootstrap() {
					return snapshot({
						repos: [bootstrapRepo({ projectExternalId: null })],
					}) as never;
				},
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
		expect(h.errors[0]).toMatch(/projectExternalId/);
		expect(h.seen).toHaveLength(0);
	});
});

describe("runCollect result reporting", () => {
	test("an incomplete scope makes the whole run a contract failure", async () => {
		// Ingest would refuse it anyway; exiting OK would let a scripted pipeline
		// carry on as though the window were covered.
		const h = harness({
			async collect() {
				const r = emptyResult();
				return {
					...r,
					manifest: {
						...r.manifest,
						scopes: [
							{
								kind: "repo",
								id: REPO_ID,
								field: "prsClosedThrough",
								baseCursor: null,
								from: "2026-07-01T00:00:00.000Z",
								watermark: "2026-07-26T00:00:00.000Z",
								commitEligible: true,
								status: "incomplete",
								errors: ["gap"],
								artifacts: [],
							},
						],
					} as CollectResult["manifest"],
				};
			},
		});
		expect(await runCollect(h.deps)).toBe(ExitCode.CONTRACT);
	});

	test("the next command is printed so the operator is not left guessing", async () => {
		const h = harness();
		await runCollect(h.deps);
		expect(h.infos.some((m) => m.includes("ingest normalized"))).toBe(true);
		expect(h.infos.some((m) => m.includes(".data/meta/runs/x.json"))).toBe(
			true,
		);
	});

	test("--no-wi and --since reach the collector verbatim", async () => {
		const h = harness({ flags: { wi: false, since: "2026-07-01" } });
		await runCollect(h.deps);
		expect(h.seen[0]?.includeWorkItems).toBe(false);
		expect(h.seen[0]?.since).toBe("2026-07-01");
	});

	test("work items are included by default", async () => {
		const h = harness();
		await runCollect(h.deps);
		expect(h.seen[0]?.includeWorkItems).toBe(true);
		expect(h.seen[0]?.since).toBeNull();
	});
});
