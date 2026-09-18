import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

test("incremental discovery upgrade preserves cached rows and starts with no inferred boundaries or work", () => {
	const db = new Database(":memory:");
	try {
		const dir = new URL("../migrations/", import.meta.url);
		for (const file of readdirSync(dir)
			.filter((name) => name.endsWith(".sql") && name < "0021")
			.sort())
			db.exec(readFileSync(new URL(file, dir), "utf8"));
		db.exec(`INSERT INTO projects(id,provider,name,organization,project_key,owner,source,created_at,updated_at) VALUES('p','ado','Project','org','project','Owner','cli',1,1);
		INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot) VALUES('pr','p','repo','999','open',2,'{"id":"pr","number":999,"repository":{"id":"repo","name":"web"},"observedAt":3}');
		UPDATE workbench_repositories SET discovery_state='complete',last_discovered_at=3;`);
		const before = db.query("SELECT * FROM pull_requests").all();
		db.exec(
			readFileSync(new URL("0021_incremental_discovery.sql", dir), "utf8"),
		);
		expect(db.query("SELECT * FROM pull_requests").all()).toEqual(before);
		expect(
			db
				.query("SELECT discovery_cursor_json FROM workbench_repositories")
				.get(),
		).toEqual({ discovery_cursor_json: null });
		expect(db.query("SELECT COUNT(*) n FROM pr_observations").get()).toEqual({
			n: 0,
		});
		expect(db.query("SELECT COUNT(*) n FROM collection_jobs").get()).toEqual({
			n: 0,
		});
	} finally {
		db.close();
	}
});

test("forward scope migration preserves watches and consumes only the matching revision's resolution", () => {
	const db = new Database(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const dir = new URL("../migrations/", import.meta.url);
		for (const file of readdirSync(dir)
			.filter((name) => name.endsWith(".sql") && name < "0020")
			.sort())
			db.exec(readFileSync(new URL(file, dir), "utf8"));
		db.exec(`INSERT INTO projects(id,provider,name,organization,project_key,repositories_json,owner,source,created_at,updated_at)
      VALUES('p','ado','Project','org','Équipe','["équipe"]','Owner','cli',1,1);
      INSERT INTO pull_requests(id,project_id,repository_id,external_id,state,updated_at,snapshot)
      VALUES('pr','p','repo','42','open',2,'{"id":"pr","repository":{"id":"repo","name":"Équipe"},"observedAt":3}');
      INSERT INTO pr_observations(id,identity,activation_token,source,project_id,ref_json,pull_id,generation,active,added_at)
      VALUES('watch','["cli","ado","org","équipe","repo",42]','token','cli','p','{"repository":{"id":"repo","name":"Équipe"}}','pr',1,1,3)`);
		const before = db.query("SELECT * FROM pr_observations").all();
		db.exec(
			readFileSync(new URL("0020_resolved_project_scope.sql", dir), "utf8"),
		);
		expect(db.query("SELECT * FROM pr_observations").all()).toEqual(before);
		expect(db.query("SELECT COUNT(*) n FROM pull_requests").get()).toEqual({
			n: 1,
		});
		db.query(
			"UPDATE projects SET project_key='équipe',revision=2,scope_resolution_json=? WHERE id='p'",
		).run(
			JSON.stringify({
				previousRevision: 1,
				revision: 2,
				identityChanged: false,
				scopeChanged: false,
				restricted: true,
				repositoryIds: ["repo"],
			}),
		);
		expect(
			db
				.query("SELECT active,generation,stop_reason FROM pr_observations")
				.get(),
		).toEqual({ active: 1, generation: 1, stop_reason: null });
		expect(
			db.query("SELECT COUNT(*) n FROM workbench_repositories").get(),
		).toEqual({ n: 1 });
		// A later raw update cannot reuse the prior command's membership decision.
		db.exec(
			"UPDATE projects SET revision=3,repositories_json='[\"outside\"]' WHERE id='p'",
		);
		expect(
			db.query("SELECT active,stop_reason FROM pr_observations").get(),
		).toEqual({ active: 0, stop_reason: "scope_changed" });
		expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		db.close();
	}
});

test("observation upgrade preserves caches and history, cancels old work and starts with an empty watch list", () => {
	const db = new Database(":memory:");
	try {
		db.exec("PRAGMA foreign_keys = ON");
		const dir = new URL("../migrations/", import.meta.url);
		for (const file of readdirSync(dir)
			.filter((name) => name.endsWith(".sql") && name < "0019")
			.sort())
			db.exec(readFileSync(new URL(file, dir), "utf8"));
		db.exec(
			"INSERT INTO projects(id,provider,name,organization,project_key,owner,source,created_at,updated_at) VALUES('p','ado','Project','Org','Project','Owner','cli',1,1)",
		);
		db.exec(
			`INSERT INTO pull_requests VALUES('pr','p','repo','42','open',2,'{"id":"pr","repository":{"id":"repo","name":"web"},"observedAt":3}')`,
		);
		db.exec(
			"INSERT INTO collection_jobs(id,project_id,revision,state,requested_at,updated_at,kind) VALUES('old','p',1,'running',1,2,'details'),('done','p',1,'complete',1,2,'list')",
		);
		db.exec(
			readFileSync(new URL("0019_observed_pull_requests.sql", dir), "utf8"),
		);
		expect(db.query("SELECT COUNT(*) AS n FROM pr_observations").get()).toEqual(
			{ n: 0 },
		);
		expect(
			db
				.query(
					"SELECT state, cancel_reason FROM collection_jobs WHERE id='old'",
				)
				.get(),
		).toEqual({ state: "canceled", cancel_reason: "watchlist_upgrade" });
		expect(
			db.query("SELECT state FROM collection_jobs WHERE id='done'").get(),
		).toEqual({ state: "complete" });
		expect(
			db.query("SELECT version, published_at FROM pull_requests").get(),
		).toEqual({ version: 1, published_at: 3 });
		expect(
			db
				.query(
					"SELECT repository_id,name,discovery_state FROM workbench_repositories",
				)
				.get(),
		).toEqual({
			repository_id: "repo",
			name: "web",
			discovery_state: "legacy",
		});
		expect(
			db
				.query(
					"SELECT cooldown_seconds FROM collection_refresh WHERE kind='list'",
				)
				.get(),
		).toEqual({ cooldown_seconds: 0 });
		db.exec("DELETE FROM projects WHERE id='p'");
		expect(db.query("SELECT COUNT(*) AS n FROM collection_jobs").get()).toEqual(
			{ n: 2 },
		);
		expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
	} finally {
		db.close();
	}
});
