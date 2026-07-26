#!/usr/bin/env bun
/**
 * Seed the local D1 with the developer + repo a fixture ingest needs (05 §10.2).
 *
 * The fixture's `developerId` / `repoId` must already exist, and the repo's
 * GUIDs must match the fixture's `sourceIds`, or the Worker rejects the chunk
 * with 422 — correctly, since it never trusts client-supplied linkage.
 *
 * Idempotent: clears its own rows first, in FK-safe order, so it can be re-run.
 */

import { parseArgs } from "node:util";

const DEFAULTS = {
	developerId: "01K0E2E06DEV00000000000000",
	alias: "e2e",
	name: "E2E Dev",
	repoId: "01K0E2E06REPO000000000000",
	org: "e2e-org",
	project: "E2E Project",
	repoName: "e2e-repo",
	repoGuid: "11111111-1111-4111-8111-111111111111",
	projectGuid: "22222222-2222-4222-8222-222222222222",
};

const { values } = parseArgs({
	options: {
		remote: { type: "boolean", default: false },
		"developer-id": { type: "string" },
		alias: { type: "string" },
		"repo-id": { type: "string" },
		org: { type: "string" },
		project: { type: "string" },
		"repo-guid": { type: "string" },
		"project-guid": { type: "string" },
		help: { type: "boolean", default: false },
	},
	allowPositionals: false,
});

if (values.help) {
	console.log(
		[
			"Usage: bun run scripts/seed-fixture.ts [options]",
			"",
			"  --remote          seed the remote D1 (default: local)",
			"  --developer-id    override developer id",
			"  --alias           override developer alias",
			"  --repo-id         override repo id",
			"  --org             override org",
			"  --project         override project",
			"  --repo-guid       override repo external_id (GUID)",
			"  --project-guid    override repo project_external_id (GUID)",
		].join("\n"),
	);
	process.exit(0);
}

const cfg = {
	developerId: values["developer-id"] ?? DEFAULTS.developerId,
	alias: values.alias ?? DEFAULTS.alias,
	name: DEFAULTS.name,
	repoId: values["repo-id"] ?? DEFAULTS.repoId,
	org: values.org ?? DEFAULTS.org,
	project: values.project ?? DEFAULTS.project,
	repoName: DEFAULTS.repoName,
	repoGuid: values["repo-guid"] ?? DEFAULTS.repoGuid,
	projectGuid: values["project-guid"] ?? DEFAULTS.projectGuid,
};

const q = (s: string) => s.replace(/'/g, "''");

const sql = `
DELETE FROM scores WHERE developer_id = '${q(cfg.developerId)}';
DELETE FROM activities WHERE developer_id = '${q(cfg.developerId)}' OR repo_id = '${q(cfg.repoId)}';
DELETE FROM repos WHERE id = '${q(cfg.repoId)}';
DELETE FROM developers WHERE id = '${q(cfg.developerId)}';
INSERT INTO developers (id, name, alias) VALUES ('${q(cfg.developerId)}', '${q(cfg.name)}', '${q(cfg.alias)}');
INSERT INTO repos (id, provider, org, project, name, external_id, project_external_id, enabled)
VALUES ('${q(cfg.repoId)}', 'ado', '${q(cfg.org)}', '${q(cfg.project)}', '${q(cfg.repoName)}', '${q(cfg.repoGuid)}', '${q(cfg.projectGuid)}', 1);
`.trim();

const target = values.remote ? "--remote" : "--local";
const proc = Bun.spawnSync(
	["bunx", "wrangler", "d1", "execute", "signoff-db", target, "--command", sql],
	{ stdout: "pipe", stderr: "pipe" },
);

if (proc.exitCode !== 0) {
	console.error(new TextDecoder().decode(proc.stderr));
	process.exit(1);
}

console.log(
	`seeded ${target}: developer=${cfg.developerId} repo=${cfg.repoId} (${cfg.org}/${cfg.project})`,
);
