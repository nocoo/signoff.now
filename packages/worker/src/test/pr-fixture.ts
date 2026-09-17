import { demoWorkspace } from "@signoff/domain/demo";
import {
	type Project,
	type PullRequest,
	projectSchema,
	pullRequestSchema,
} from "@signoff/domain/workbench";
import type { SqliteD1 } from "./sqlite-d1";

export const PR_TEST_NOW = Date.parse("2026-09-17T12:00:00Z") / 1000;
const fixture = demoWorkspace(PR_TEST_NOW);
const projectTemplate = projectSchema.parse(fixture.projects[0]);
const pullTemplate = pullRequestSchema.parse(fixture.pullRequests[0]);

export function seedProject(
	sqlite: SqliteD1,
	overrides: Partial<Project> = {},
): Project {
	const project: Project = {
		...projectTemplate,
		id: "live-project",
		source: "cli",
		organization: "test-org",
		projectKey: "Platform",
		...overrides,
	};
	sqlite.raw
		.query(`INSERT INTO projects (id, provider, name, organization, project_key, repositories_json, description, owner, enabled, source, revision, created_at, updated_at, last_scanned_at, scan_state, scan_message)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.run(
			project.id,
			project.provider,
			project.name,
			project.organization,
			project.projectKey,
			JSON.stringify(project.repositories ?? []),
			project.description,
			project.owner,
			Number(project.enabled),
			project.source,
			project.revision,
			project.createdAt,
			project.updatedAt,
			project.lastScannedAt,
			project.scanState,
			project.scanMessage,
		);
	return project;
}

export function seedPull(
	sqlite: SqliteD1,
	overrides: Partial<PullRequest> = {},
): PullRequest {
	const pull: PullRequest = {
		...pullTemplate,
		id: "pull-1",
		projectId: "live-project",
		number: 1,
		externalId: "1",
		repository: { id: "repo-1", name: "web-app" },
		author: { id: "actor-1", name: "Alice" },
		createdAt: PR_TEST_NOW - 86400,
		observedAt: PR_TEST_NOW,
		state: "open",
		draft: false,
		...overrides,
	};
	sqlite.raw
		.query(
			"INSERT OR REPLACE INTO pull_requests (id, project_id, repository_id, external_id, state, updated_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			pull.id,
			pull.projectId,
			pull.repository.id,
			pull.externalId,
			pull.state,
			pull.updatedAt,
			JSON.stringify(pull),
		);
	return pull;
}
