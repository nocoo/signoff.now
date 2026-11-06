import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	commandReceiptSchema,
	jobQuerySchema,
	pullDetailSchema,
} from "@signoff/domain/query";
import app from "../index";
import { seedProject } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
let server: ReturnType<typeof Bun.serve>;
let directory: string;
const repo = {
	id: "repo-1",
	name: "web-app",
	projectExternalId: "external-project",
};
const repositoryUrl = "https://dev.azure.com/test-org/Platform/_git/web-app";
const main = fileURLToPath(
	new URL("../../../../apps/collect/src/main.ts", import.meta.url),
);
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), "signoff-import-"));
	sqlite = createSqliteD1();
	seedProject(sqlite, { repositories: [repo.id] });
	sqlite.raw
		.query(
			"INSERT INTO workbench_repositories(project_id,repository_id,name,project_external_id) VALUES(?,?,?,?)",
		)
		.run("live-project", repo.id, repo.name, repo.projectExternalId);
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (req) => app.fetch(req, { DB: sqlite.db, SIGNOFF_LOCAL_TRUST: "1" }),
	});
});
afterEach(() => {
	server.stop(true);
	sqlite.close();
	rmSync(directory, { recursive: true, force: true });
});
async function cli(...args: string[]) {
	const child = Bun.spawn(
		[
			process.execPath,
			main,
			"--api-base",
			`http://127.0.0.1:${server.port}`,
			...args,
		],
		{
			cwd: directory,
			env: { PATH: directory, NODE_ENV: "test" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}
async function collect(jobId: string, missing: boolean) {
	const moduleUrl = (relative: string) =>
		JSON.stringify(
			new URL(`../../../../apps/collect/src/${relative}`, import.meta.url).href,
		);
	const script = `
		const { AdoError } = await import(${moduleUrl("ado/client.ts")});
		const { createCollectionClient } = await import(${moduleUrl("workbench/client.ts")});
		const { runCollectionOnce } = await import(${moduleUrl("workbench/run.ts")});
		const repo = ${JSON.stringify(repo)};
		const urls = [];
		const ado = {
			checkAuth: async () => {},
			invalidateToken: () => {},
			getPage: async () => { throw new Error("Import must never list provider data"); },
			post: async () => { throw new Error("Import must never write provider data"); },
			get: async (url) => {
				urls.push(url);
				const number = Number(new URL(url).pathname.split("/").at(-1));
				if (number === 102 && ${JSON.stringify(missing)})
					throw new AdoError("not_found", "Synthetic missing PR");
				return {
					pullRequestId: number, status: "completed", title: "Old PR " + number,
					isDraft: false, creationDate: "2026-01-01T00:00:00Z", closedDate: "2026-02-01T00:00:00Z",
					createdBy: { id: "author", displayName: "Author" },
					sourceRefName: "refs/heads/feature", targetRefName: "refs/heads/main",
					repository: { id: repo.id, name: repo.name, project: { id: repo.projectExternalId, name: "Platform" } },
				};
			},
		};
		const result = await runCollectionOnce({
			api: createCollectionClient({ apiBase: ${JSON.stringify(`http://127.0.0.1:${server.port}`)} }),
			makeAdo: () => ado, log: { info: () => {}, warn: () => {}, error: () => {} },
			jobId: ${JSON.stringify(jobId)},
		});
		console.log(JSON.stringify({ ...result, urls }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", script], {
		cwd: directory,
		env: { PATH: directory, NODE_ENV: "test" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(stderr).toBe("");
	expect(code).toBe(0);
	return JSON.parse(stdout) as { state: string; urls: string[] };
}
test("real CLI -> local HTTP -> leased injected provider -> cache/job queries, including partial failure and retry", async () => {
	const queued = await cli(
		"pr",
		"import",
		"101",
		"102",
		"101",
		"--repo",
		repositoryUrl,
	);
	expect(queued.code).toBe(0);
	const receipt = commandReceiptSchema.parse(JSON.parse(queued.stdout));
	expect(receipt.jobs.map((job) => job.importNumber)).toEqual([101, 102]);
	const urls: string[] = [];
	for (const job of receipt.jobs) {
		const result = await collect(job.id, true);
		urls.push(...result.urls);
		expect(result.state).toBe(job.importNumber === 101 ? "complete" : "failed");
	}
	const success = await cli("job", "get", receipt.jobs[0]!.id);
	expect(success.code).toBe(0);
	expect(jobQuerySchema.parse(JSON.parse(success.stdout))).toMatchObject({
		kind: "import",
		state: "succeeded",
		result: { number: 101 },
	});
	const failure = await cli("job", "get", receipt.jobs[1]!.id);
	expect(failure.code).toBe(3);
	expect(jobQuerySchema.parse(JSON.parse(failure.stdout))).toMatchObject({
		importNumber: 102,
		state: "failed",
		error: "not_found",
		result: null,
	});
	const cached = await cli("pr", "get", "101", "--repo", repositoryUrl);
	expect(cached.code).toBe(0);
	expect(pullDetailSchema.parse(JSON.parse(cached.stdout)).data).toMatchObject({
		id: "ado:live-project:repo-1:101",
		state: "merged",
		observation: null,
	});
	expect(
		(await cli("pr", "get", "102", "--repo", repositoryUrl)).code,
	).not.toBe(0);
	expect(sqlite.raw.query("SELECT * FROM pr_observations").all()).toEqual([]);
	const retry = commandReceiptSchema.parse(
		JSON.parse(
			(await cli("pr", "import", "101", "102", "--repo", repositoryUrl)).stdout,
		),
	);
	for (const job of retry.jobs) {
		const result = await collect(job.id, false);
		urls.push(...result.urls);
		expect(result.state).toBe("complete");
	}
	expect(urls.map((url) => new URL(url).pathname.split("/").at(-1))).toEqual([
		"101",
		"102",
		"101",
		"102",
	]);
	expect(
		sqlite.raw
			.query("SELECT external_id FROM pull_requests ORDER BY external_id")
			.all(),
	).toEqual([{ external_id: "101" }, { external_id: "102" }]);
}, 30_000);
test("import HTTP rejects Sample, unresolved/foreign scopes and malformed numbers without mutations", async () => {
	for (const changes of [
		{ source: "sample" },
		{ numbers: [0] },
		{ numbers: [1.5] },
		{ numbers: [] },
		{ repositoryUrl: repositoryUrl.replace("web-app", "foreign") },
		{ repositoryUrl: repositoryUrl.replace("Platform", "foreign") },
	]) {
		const response = await fetch(
			`http://127.0.0.1:${server.port}/api/commands/v1/import-prs`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					source: "live",
					repositoryUrl,
					numbers: [1],
					...changes,
				}),
			},
		);
		expect(response.status).toBeGreaterThanOrEqual(400);
	}
	sqlite.raw.exec("UPDATE workbench_repositories SET project_external_id=NULL");
	expect(
		(await cli("pr", "import", "1", "--repo", repositoryUrl)).code,
	).not.toBe(0);
	expect(
		(await cli("pr", "import", "-1", "--repo", repositoryUrl)).code,
	).not.toBe(0);
	expect(sqlite.raw.query("SELECT * FROM collection_jobs").all()).toEqual([]);
});
test("import is default-deny without local trust and unavailable to machine endpoints", async () => {
	for (const [host, trust] of [
		["localhost", undefined],
		["signoff-ingest.test", "1"],
	] as const) {
		const response = await app.request(
			`http://${host}/api/commands/v1/import-prs`,
			{
				method: "POST",
				headers: { host, "content-type": "application/json" },
				body: JSON.stringify({ repositoryUrl, numbers: [1] }),
			},
			{
				DB: sqlite.db,
				SIGNOFF_LOCAL_TRUST: trust,
				CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
				CF_ACCESS_AUD: "synthetic-audience",
			},
		);
		expect([401, 403]).toContain(response.status);
	}
	expect(sqlite.raw.query("SELECT * FROM collection_jobs").all()).toEqual([]);
});
