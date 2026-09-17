import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoWorkspace } from "../packages/domain/src/demo.js";

// This command has no remote option. It resets only the four named demo projects.
if (process.argv.length > 2)
	throw new Error("db:seed:local takes no arguments and only writes local D1");
const fixture = demoWorkspace(Math.floor(Date.now() / 1000));
const sql = (value: string | number | null) =>
	value === null
		? "NULL"
		: typeof value === "number"
			? String(value)
			: `'${value.replaceAll("'", "''")}'`;
const statements = [
	`DELETE FROM projects WHERE source = 'demo' AND id IN (${fixture.projects.map((p) => sql(p.id)).join(",")});`,
	...fixture.projects.map(
		(
			p,
		) => `INSERT INTO projects (id, provider, name, organization, project_key, description, owner, enabled, source, revision, created_at, updated_at, last_scanned_at, scan_state, scan_message)
		VALUES (${[p.id, p.provider, p.name, p.organization, p.projectKey, p.description, p.owner, Number(p.enabled), p.source, p.revision, p.createdAt, p.updatedAt, p.lastScannedAt, p.scanState, p.scanMessage].map(sql).join(",")});`,
	),
	...fixture.pullRequests.map(
		(
			pr,
		) => `INSERT INTO pull_requests (id, project_id, repository_id, external_id, state, updated_at, snapshot)
		VALUES (${[pr.id, pr.projectId, pr.repository.id, pr.externalId, pr.state, pr.updatedAt, JSON.stringify(pr)].map(sql).join(",")});`,
	),
	...fixture.scans.map(
		(
			s,
		) => `INSERT INTO scan_runs (id, project_id, source, state, started_at, completed_at, pull_request_count, advanced_stages, message)
		VALUES (${[s.id, s.projectId, s.source, s.state, s.startedAt, s.completedAt, s.pullRequestCount, s.advancedStages, s.message].map(sql).join(",")});`,
	),
];
const directory = mkdtempSync(join(tmpdir(), "signoff-demo-"));
try {
	const file = join(directory, "seed.sql");
	writeFileSync(file, statements.join("\n"));
	const result = spawnSync(
		"bunx",
		["wrangler", "d1", "execute", "signoff-db", "--local", "--file", file],
		{
			cwd: join(import.meta.dirname, ".."),
			stdio: "inherit",
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`Local seed failed (${result.status})`);
	console.log(
		`Seeded ${fixture.projects.length} demo projects and ${fixture.pullRequests.length} PRs in local D1.`,
	);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
