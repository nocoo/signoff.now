import type { demoWorkspace } from "@signoff/domain/demo";
import { identityKey } from "@signoff/domain/insights";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const TEAMS = [
	{
		id: "platform",
		name: "Platform engineering",
		members: ["maya", "alex", "nina"],
		tag: "core",
	},
	{
		id: "product",
		name: "Product experience",
		members: ["james", "luis", "sarah"],
		tag: "customer",
	},
	{
		id: "maintainers",
		name: "Release maintainers",
		members: ["maya", "nina", "luis"],
		tag: "maintainers",
	},
];

/** Local sample initialization, with no Live writes or project-preference resets. */
export function demoDirectoryStatements(
	fixture: ReturnType<typeof demoWorkspace>,
): string[] {
	if (fixture.projects.some((project) => project.source !== "demo"))
		throw new Error("Sample directory requires only Sample projects");
	const projects = new Map(
		fixture.projects.map((project) => [project.id, project]),
	);
	const followed = new Set(TEAMS.flatMap((team) => team.members));
	const people = new Map(
		fixture.pullRequests
			.filter((pull) => followed.has(pull.author.id))
			.map((pull) => [pull.author.id, pull.author]),
	);
	const statements = [
		...[
			{ id: "core", name: "Core systems", color: "#0EA5E9" },
			{ id: "customer", name: "Customer experience", color: "#8B5CF6" },
			{ id: "maintainers", name: "Maintainers", color: "#10B981" },
		].map(
			(tag) =>
				`INSERT OR IGNORE INTO tags (id, source, name, color) VALUES (${quote(`sample-tag-${tag.id}`)}, 'demo', ${quote(tag.name)}, ${quote(tag.color)});`,
		),
		...TEAMS.map(
			(team) =>
				`INSERT OR IGNORE INTO teams (id, source, name) VALUES (${quote(`sample-team-${team.id}`)}, 'demo', ${quote(team.name)});`,
		),
		...[...people.values()].map(
			(person) =>
				`INSERT OR IGNORE INTO developers (id, source, name, alias) VALUES (${quote(`sample-member-${person.id}`)}, 'demo', ${quote(person.name)}, ${quote(`sample-${person.id}`)});`,
		),
	];
	for (const team of TEAMS) {
		for (const id of team.members)
			statements.push(`INSERT OR IGNORE INTO developer_teams (developer_id, team_id)
			SELECT d.id, t.id FROM developers d, teams t WHERE d.source = 'demo' AND t.source = 'demo'
			AND d.id = ${quote(`sample-member-${id}`)} AND t.id = ${quote(`sample-team-${team.id}`)};`);
		statements.push(`INSERT OR IGNORE INTO team_tags (team_id, tag_id)
			SELECT t.id, tag.id FROM teams t, tags tag WHERE t.source = 'demo' AND tag.source = 'demo'
			AND t.id = ${quote(`sample-team-${team.id}`)} AND tag.id = ${quote(`sample-tag-${team.tag}`)};`);
	}
	const accounts = new Set<string>();
	for (const pull of fixture.pullRequests) {
		const project = projects.get(pull.projectId);
		if (!project || !followed.has(pull.author.id)) continue;
		const key = identityKey(
			project.provider,
			project.organization,
			pull.author.id,
		);
		if (accounts.has(key)) continue;
		accounts.add(key);
		statements.push(`INSERT OR IGNORE INTO developer_identities (source, identity_key, provider, organization, actor_id, developer_id, name, handle, last_seen_at)
			SELECT 'demo', ${quote(key)}, ${quote(project.provider)}, ${quote(project.organization)}, ${quote(pull.author.id)}, id, ${quote(pull.author.name)}, ${quote(pull.author.id)}, ${pull.observedAt}
			FROM developers WHERE id = ${quote(`sample-member-${pull.author.id}`)} AND source = 'demo';`);
	}
	return statements;
}
