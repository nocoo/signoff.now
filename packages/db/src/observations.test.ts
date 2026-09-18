import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

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
