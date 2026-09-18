import { afterEach, beforeEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import app from "../index";
import { seedProject, seedPull } from "../test/pr-fixture";
import { createSqliteD1, type SqliteD1 } from "../test/sqlite-d1";

let sqlite: SqliteD1;
let server: ReturnType<typeof Bun.serve>;
const main = fileURLToPath(
	new URL("../../../../apps/collect/src/main.ts", import.meta.url),
);
beforeEach(() => {
	sqlite = createSqliteD1();
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (req) => app.fetch(req, { DB: sqlite.db, SIGNOFF_DEMO_MODE: "1" }),
	});
});
afterEach(() => {
	server.stop(true);
	sqlite.close();
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
			cwd: "/tmp",
			env: { PATH: "/nonexistent", NODE_ENV: "test" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return {
		stdout,
		stderr,
		code,
		json: stdout.startsWith("{") ? JSON.parse(stdout) : null,
	};
}
test("real query CLI and web share watches, including Draft; every command works without az", async () => {
	const project = seedProject(sqlite, { repositories: [] });
	const pull = seedPull(sqlite, { draft: true });
	expect((await cli("watch", "list")).json.page.total).toBe(0);
	expect((await cli("status")).json.watching).toBe(0);
	const added = await cli("watch", "add", pull.id);
	expect(added.code).toBe(0);
	expect(added.stderr).toBe("");
	expect(added.json.results[0].status).toBe("added");
	const browser = (await fetch(
		`http://127.0.0.1:${server.port}/api/query/v1/observations`,
	).then((r) => r.json())) as { data: { id: string }[] };
	expect(browser.data[0]?.id).toBe(added.json.results[0].observation.id);
	expect(
		(await cli("pr", "list", "--watching", "--draft", "include", "--all")).json
			.data[0].state,
	).toBe("draft");
	expect((await cli("pr", "get", pull.id)).json.data.id).toBe(pull.id);
	expect((await cli("refresh", "--pr", pull.id)).json.jobs[0].coalesced).toBe(
		true,
	);
	expect(
		(await cli("job", "get", added.json.results[0].job.id)).json.kind,
	).toBe("refresh");
	expect((await cli("watch", "remove", pull.id)).json.results[0].status).toBe(
		"removed",
	);
	expect(
		(await cli("watch", "list", "--include-stopped")).json.data[0].active,
	).toBe(false);
	const repositoryUrl = `https://dev.azure.com/${project.organization}/${project.projectKey}/_git/${pull.repository.name}`;
	expect((await cli("repo", "add", repositoryUrl)).code).toBe(0);
	expect((await cli("repo", "list")).json.data[0].repository.id).toBe(
		pull.repository.id,
	);
	expect(
		(await cli("discover", "--repo", repositoryUrl)).json.jobs[0].kind,
	).toBe("discover");
	expect(
		sqlite.raw
			.query("SELECT COUNT(*) AS n FROM pr_observations WHERE active=1")
			.get(),
	).toEqual({ n: 0 });
});
test("CLI keeps stdout clean on errors and help needs no provider or service", async () => {
	const invalid = await cli("pr", "get", "42");
	expect(invalid.code).toBe(3);
	expect(invalid.stdout).toBe("");
	expect(JSON.parse(invalid.stderr).error.code).toBe("INVALID_ARGUMENT");
	expect((await cli("pr", "get", "missing")).code).toBe(5);
	expect((await cli("refresh", "--all", "--pr", "missing")).code).toBe(3);
	expect((await cli("pr", "list", "--unknown")).code).toBe(3);
	expect((await cli("--help")).code).toBe(0);
	expect((await cli("--version")).code).toBe(0);
});
