import { expect, test } from "bun:test";
import { demoWorkspace } from "@signoff/domain/demo";
import { demoDirectoryStatements } from "../lib/demo-directory";
import { readDirectory } from "../routes/directory";
import { createSqliteD1 } from "./sqlite-d1";

test("seeds only Sample memberships and exact accounts, idempotently, leaving Live data intact", async () => {
	const sqlite = createSqliteD1();
	try {
		sqlite.raw
			.query(
				"INSERT INTO developers (id, name, alias) VALUES ('live-person', 'Live person', 'live')",
			)
			.run();
		const fixture = demoWorkspace(1_789_632_000);
		const sql = demoDirectoryStatements(fixture);
		for (const statement of sql) sqlite.raw.exec(statement);
		const first = await readDirectory(sqlite.db, "demo");
		expect(first.members).toHaveLength(6);
		expect(first.teams).toHaveLength(3);
		expect(first.tags).toHaveLength(3);
		expect(
			first.members.find((member) => member.name === "Maya Chen")?.teamIds,
		).toHaveLength(2);
		expect(new Set(first.identities.map((identity) => identity.key)).size).toBe(
			first.identities.length,
		);
		expect(
			new Set(first.identities.map((identity) => identity.provider)),
		).toEqual(new Set(["ado", "github"]));
		for (const statement of sql) sqlite.raw.exec(statement);
		expect(await readDirectory(sqlite.db, "demo")).toEqual(first);
		expect(
			(await readDirectory(sqlite.db, "cli")).members.map(
				(member) => member.id,
			),
		).toEqual(["live-person"]);
		expect(() =>
			demoDirectoryStatements({
				...fixture,
				projects: [{ ...fixture.projects[0]!, source: "cli" }],
			}),
		).toThrow("Sample");
	} finally {
		sqlite.close();
	}
});
