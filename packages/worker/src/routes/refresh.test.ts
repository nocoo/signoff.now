import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setSystemTime,
	test,
} from "bun:test";
import {
	adoPullId,
	type CollectorClaim,
	collectorClaimSchema,
} from "@signoff/domain/collection";
import { demoWorkspace } from "@signoff/domain/demo";
import {
	type Project,
	type PullRequest,
	projectSchema,
} from "@signoff/domain/workbench";
import app from "../index.js";
import { setAccessJwtVerifierForTests } from "../middleware/access-auth.js";
import {
	createConcurrentSqliteD1,
	createSqliteD1,
	type SqliteD1,
} from "../test/sqlite-d1.js";

let sqlite: SqliteD1;
let sequence = 0;
const epoch = 1_800_000_000;
const clock = (seconds: number) =>
	setSystemTime(new Date((epoch + seconds) * 1000));
beforeEach(() => {
	clock(0);
	sequence = 0;
	sqlite = createSqliteD1();
});
afterEach(() => {
	sqlite.close();
	setAccessJwtVerifierForTests(null);
	setSystemTime();
});
const request = (
	path: string,
	body?: unknown,
	method = "POST",
	host = "localhost",
	db = sqlite.db,
) =>
	app.request(
		`http://${host}${path}`,
		{
			method,
			headers: { host, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		{ DB: db },
	);
async function project(name = "App", db = sqlite.db) {
	const res = await request(
		"/api/projects",
		{
			provider: "ado",
			name,
			organization: "acme",
			projectKey: name,
			repositories: ["app"],
			description: "",
			owner: "Maintainers",
			enabled: true,
		},
		"POST",
		"localhost",
		db,
	);
	expect(res.status).toBe(201);
	return projectSchema.parse(await res.json());
}
function seed(p: Project, count: number, raw = sqlite.raw) {
	return Array.from({ length: count }, (_, index) => {
		const number = index + 1;
		const pull: PullRequest = {
			...demoWorkspace(epoch).pullRequests[0]!,
			id: adoPullId(p.id, "repo", String(number)),
			projectId: p.id,
			externalId: String(number),
			number,
			repository: { id: "repo", name: "app" },
			state: "open",
			draft: false,
			observedAt: epoch,
			headSha: "head",
			checksObservedAt: epoch - 3600,
		};
		raw
			.query(
				"INSERT INTO pull_requests (id,project_id,repository_id,external_id,state,updated_at,snapshot) VALUES (?,?,?,?,?,?,?)",
			)
			.run(
				pull.id,
				p.id,
				"repo",
				String(number),
				pull.state,
				pull.updatedAt,
				JSON.stringify(pull),
			);
		return pull;
	});
}
const viewId = "a553b424-6238-4923-84c4-67a0b72c9792";
async function view(
	pulls: PullRequest[],
	visible = true,
	refresh = false,
	pageKey = "page-1",
	db = sqlite.db,
) {
	const res = await request(
		"/api/collection/view",
		{
			viewId,
			sequence: ++sequence,
			visible,
			refresh,
			pageKey,
			pullIds: pulls.map((pull) => pull.id),
		},
		"POST",
		"localhost",
		db,
	);
	expect(res.status).toBe(200);
}
async function schedule(kind: "list" | "details", db = sqlite.db) {
	const res = await request(
		"/api/collector/schedule",
		{ kind },
		"POST",
		"localhost",
		db,
	);
	expect(res.status).toBe(200);
	return res.json() as Promise<{
		kind: string;
		roundId: string | null;
		lastCompletedAt: number | null;
		cooldownSeconds: number;
		completedJobs: number;
		totalJobs: number;
	}>;
}
async function claim(kind: "list" | "details", db = sqlite.db) {
	const res = await request(
		`/api/collector/claim?kind=${kind}`,
		undefined,
		"POST",
		"localhost",
		db,
	);
	expect(res.status).toBe(200);
	const value = await res.json();
	return value === null ? null : collectorClaimSchema.parse(value);
}
async function finish(job: CollectorClaim, failure = false) {
	if (failure) {
		const res = await request(`/api/collector/jobs/${job.job.id}/fail`, {
			leaseToken: job.leaseToken,
			kind: "unavailable",
			message: "Temporary provider error",
		});
		expect(res.status).toBe(200);
		return;
	}
	const pulls = (job.targets ?? []).map((p) => ({
		...p,
		observedAt: Math.floor(Date.now() / 1000),
		checksObservedAt: Math.floor(Date.now() / 1000),
	}));
	if (pulls.length)
		expect(
			(
				await request(`/api/collector/jobs/${job.job.id}/batch`, {
					leaseToken: job.leaseToken,
					pulls,
				})
			).status,
		).toBe(200);
	const res = await request(`/api/collector/jobs/${job.job.id}/complete`, {
		leaseToken: job.leaseToken,
		state: "complete",
		pullRequestCount: pulls.length,
		message: "Done",
	});
	expect(res.status).toBe(200);
}

describe("two completion-based refresh queues", () => {
	test("explicit full sync claims only its requested job, waits for publication, and can bypass queued automatic work", async () => {
		for (const busy of [false, true]) {
			const p = await project(`Selected-${busy}`);
			const pulls = seed(p, 1);
			await view(pulls, true, true, `page-${busy}`);
			await schedule("details");
			const inFlight = busy ? await claim("details") : null;
			await view([], false, false, `page-${busy}`);
			const other = await project(`Other-${busy}`);
			await request(`/api/projects/${other.id}/scan`, {
				revision: other.revision,
			});
			await schedule("list");
			const queued = await request(`/api/projects/${p.id}/scan`, {
				revision: p.revision,
			});
			const job = (await queued.json()) as { id: string };
			expect(
				await (await request("/api/collector/claim?jobId=missing")).json(),
			).toBeNull();
			if (inFlight) {
				expect(
					await (await request(`/api/collector/claim?jobId=${job.id}`)).json(),
				).toBeNull();
				await finish(inFlight);
			}
			const claimed = collectorClaimSchema.parse(
				await (await request(`/api/collector/claim?jobId=${job.id}`)).json(),
			);
			expect(claimed.job.id).toBe(job.id);
			expect(claimed.job.kind).toBe("full");
			expect(claimed.job.roundId).toBeNull();
			expect(claimed.project.id).toBe(p.id);
			await finish(claimed);
		}
		expect((await request("/api/collector/claim?jobId=")).status).toBe(400);
	});
	test("a newer membership heartbeat preserves the immediate refresh intent of navigation", async () => {
		const p = await project();
		const pulls = seed(p, 2);
		await view(pulls.slice(0, 1), true, true);
		await schedule("details");
		await finish((await claim("details"))!);
		await schedule("details");
		clock(10);
		const navigationSequence = ++sequence;
		await view(pulls.slice(1), true, false, "page-2");
		await request("/api/collection/view", {
			viewId,
			sequence: navigationSequence,
			visible: true,
			refresh: true,
			pageKey: "page-2",
			pullIds: [pulls[1]!.id],
		});
		expect((await schedule("details")).roundId).not.toBeNull();
		expect((await claim("details"))!.targets?.map((pull) => pull.id)).toEqual([
			pulls[1]!.id,
		]);
	});
	test("foreground transition starts immediately even if its ordinary heartbeat arrives before the refresh notification", async () => {
		const p = await project();
		const pulls = seed(p, 1);
		await view(pulls, true, true);
		await schedule("details");
		await finish((await claim("details"))!);
		await schedule("details");
		await view(pulls, false);
		clock(10);
		await view(pulls, true, false);
		expect((await schedule("details")).roundId).not.toBeNull();
	});
	test("a heartbeat from another view cannot displace the active page before its lease expires", async () => {
		const p = await project();
		const pulls = seed(p, 2);
		await view(pulls.slice(0, 1), true, true);
		const original = await schedule("details");
		const other = {
			viewId: "d02a0cac-bd3d-497d-9558-ace92e15e1dc",
			sequence: 10,
			visible: true,
			refresh: false,
			pageKey: "other-page",
			pullIds: [pulls[1]!.id],
		};
		await request("/api/collection/view", other);
		expect((await schedule("details")).roundId).toBe(original.roundId);
		expect((await claim("details"))!.targets?.map((pull) => pull.id)).toEqual([
			pulls[0]!.id,
		]);
		clock(46);
		await request("/api/collection/view", { ...other, sequence: 11 });
		expect(
			sqlite.raw
				.query(
					"SELECT view_id, refresh_requested FROM collection_refresh WHERE kind = 'details'",
				)
				.get(),
		).toEqual({ view_id: other.viewId, refresh_requested: 1 });
	});
	test("foreground return also refreshes when the last job finished before the round was settled", async () => {
		const p = await project();
		const pulls = seed(p, 1);
		await view(pulls, true, true);
		const before = await schedule("details");
		await finish((await claim("details"))!);
		await view(pulls, false);
		clock(10);
		await view(pulls, true, true);
		const after = await schedule("details");
		expect(after.roundId).not.toBeNull();
		expect(after.roundId).not.toBe(before.roundId);
	});
	test("a due list gets a turn between detail jobs for the same project", async () => {
		const p = await project();
		const pulls = seed(p, 2);
		await view(pulls, true, true);
		await schedule("details");
		const first = (await claim("details"))!;
		await schedule("list");
		await finish(first);
		expect(await claim("details")).toBeNull();
		await finish((await claim("list"))!);
		expect(await claim("details")).not.toBeNull();
	});
	test("explicit list refresh works with automatic discovery disabled, including an already paused job", async () => {
		const p = await project();
		await schedule("list");
		await request(
			"/api/collection/settings",
			{ listCooldownSeconds: 0 },
			"PATCH",
		);
		expect(await claim("list")).toBeNull();
		expect(
			(
				await request(`/api/projects/${p.id}/scan`, {
					revision: p.revision,
					pullIds: [],
				})
			).status,
		).toBe(200);
		expect(await claim("list")).not.toBeNull();
	});
	test("an expired login pauses its round until credentials recover, then starts cooldown after completion", async () => {
		await project();
		const round = await schedule("list");
		const pending = (await claim("list"))!;
		await request(`/api/collector/jobs/${pending.job.id}/fail`, {
			leaseToken: pending.leaseToken,
			kind: "auth_required",
			message: "Run az login",
		});
		clock(30);
		expect((await schedule("list")).roundId).toBe(round.roundId);
		expect(await claim("list")).toBeNull();
		await request("/api/collector/heartbeat", {
			state: "ready",
			message: "Session restored",
		});
		await finish((await claim("list"))!);
		expect((await schedule("list")).lastCompletedAt).toBe(epoch + 30);
	});
	test("list cooldown starts after the final project finishes, even when a round exceeds its interval", async () => {
		await project("One");
		await project("Two");
		const first = await schedule("list");
		expect(first.cooldownSeconds).toBe(120);
		expect(first.totalJobs).toBe(2);
		const one = (await claim("list"))!;
		clock(20);
		await finish(one);
		const two = (await claim("list"))!;
		clock(119);
		expect((await schedule("list")).roundId).toBe(first.roundId);
		expect(await claim("list")).toBeNull();
		clock(130);
		await finish(two);
		const cooling = await schedule("list");
		expect(cooling.roundId).toBeNull();
		expect(cooling.lastCompletedAt).toBe(epoch + 130);
		clock(249);
		expect((await schedule("list")).roundId).toBeNull();
		clock(250);
		expect((await schedule("list")).roundId).not.toBeNull();
	});
	test("details only queues the current page, waits for the entire round, and has its own five-minute cooldown", async () => {
		const p = await project();
		const pulls = seed(p, 21);
		await view(pulls.slice(0, 20), true, true);
		const started = await schedule("details");
		expect(started.cooldownSeconds).toBe(300);
		expect(started.totalJobs).toBe(20);
		const queued = sqlite.raw
			.query("SELECT pull_ids_json FROM collection_jobs WHERE kind = 'details'")
			.all() as { pull_ids_json: string }[];
		expect(
			queued.flatMap((row) => JSON.parse(row.pull_ids_json)),
		).not.toContain(pulls[20]!.id);
		for (let n = 0; n < 20; n++) {
			clock(n);
			await finish((await claim("details"))!);
		}
		expect((await schedule("details")).lastCompletedAt).toBe(epoch + 19);
		for (let seconds = 30; seconds < 300; seconds += 30) {
			clock(seconds);
			await view(pulls.slice(0, 20));
		}
		clock(300);
		await view(pulls.slice(0, 20));
		expect((await schedule("details")).roundId).toBeNull();
		clock(319);
		await view(pulls.slice(0, 20));
		expect((await schedule("details")).totalJobs).toBe(20);
	});
	test("background pauses queued details while list discovery continues independently; foreground resumes without overlap", async () => {
		const p = await project();
		const pulls = seed(p, 2);
		await view(pulls, true, true);
		const started = await schedule("details");
		const inFlight = (await claim("details"))!;
		await view(pulls, false);
		expect(await claim("details")).toBeNull();
		clock(1);
		await finish(inFlight);
		const list = await schedule("list");
		expect(list.totalJobs).toBe(1);
		const listJob = (await claim("list"))!;
		expect(listJob.job.pullIds).toEqual([]);
		await finish(listJob);
		expect(await claim("details")).toBeNull();
		await view(pulls, true, true);
		expect((await schedule("details")).roundId).toBe(started.roundId);
		const resumed = (await claim("details"))!;
		expect(resumed.job.id).not.toBe(inFlight.job.id);
		await finish(resumed);
		expect((await schedule("details")).roundId).toBeNull();
	});
	test("foreground return starts a fresh round before cooldown expiry, but ordinary heartbeats do not reset it", async () => {
		const p = await project();
		const pulls = seed(p, 1);
		await view(pulls, true, true);
		await schedule("details");
		await finish((await claim("details"))!);
		await schedule("details");
		clock(10);
		await view(pulls);
		expect((await schedule("details")).roundId).toBeNull();
		await view(pulls, false);
		await view(pulls, true, true);
		expect((await schedule("details")).roundId).not.toBeNull();
		expect(
			sqlite.raw
				.query(
					"SELECT COUNT(*) AS n FROM collection_jobs WHERE kind = 'details' AND state = 'queued'",
				)
				.get(),
		).toEqual({ n: 1 });
	});
	test("navigation retires the old page queue and waits for any in-flight PR before starting the new page", async () => {
		const p = await project();
		const pulls = seed(p, 3);
		await view(pulls.slice(0, 2), true, true);
		const first = await schedule("details");
		const running = (await claim("details"))!;
		await view(pulls.slice(2), true, true, "page-2");
		expect((await schedule("details")).roundId).toBe(first.roundId);
		expect(await claim("details")).toBeNull();
		await finish(running);
		const next = await schedule("details");
		expect(next.roundId).not.toBe(first.roundId);
		expect((await claim("details"))!.targets?.map((pull) => pull.id)).toEqual([
			pulls[2]!.id,
		]);
	});
	test("failed jobs finish the round and cool down; interval changes are measured against completion", async () => {
		await project();
		await schedule("list");
		const job = (await claim("list"))!;
		clock(30);
		await finish(job, true);
		expect((await schedule("list")).lastCompletedAt).toBe(epoch + 30);
		clock(89);
		expect(
			(
				await request(
					"/api/collection/settings",
					{ listCooldownSeconds: 60 },
					"PATCH",
				)
			).status,
		).toBe(200);
		expect((await schedule("list")).roundId).toBeNull();
		clock(90);
		expect((await schedule("list")).roundId).not.toBeNull();
	});
	test("concurrent scheduler and claim calls cannot duplicate rounds or run two jobs for one project", async () => {
		const concurrent = createConcurrentSqliteD1();
		try {
			const [one, two] = concurrent.connections as [D1Database, D1Database];
			const p = await project("App", one);
			const pulls = seed(p, 2, concurrent.raw);
			await view(pulls, true, true, "page-1", one);
			concurrent.barrierBeforeBatch(
				"UPDATE collection_refresh SET round_id",
				2,
			);
			const rounds = await Promise.all([
				schedule("details", one),
				schedule("details", two),
			]);
			expect(concurrent.barrierArrivals()).toBe(2);
			expect(rounds[0].roundId).toBe(rounds[1].roundId);
			expect(
				concurrent.raw.query("SELECT COUNT(*) AS n FROM collection_jobs").get(),
			).toEqual({ n: 2 });
			concurrent.barrierBeforeBatch("started_at = COALESCE", 2);
			const claimed = await Promise.all([
				claim("details", one),
				claim("details", two),
			]);
			expect(concurrent.barrierArrivals()).toBe(2);
			expect(claimed.filter(Boolean)).toHaveLength(1);
		} finally {
			concurrent.close();
		}
	});
	test("expired view leases pause details, and disabled queues cannot be scheduled", async () => {
		const p = await project();
		const pulls = seed(p, 1);
		await view(pulls, true, true);
		await schedule("details");
		clock(46);
		expect(await claim("details")).toBeNull();
		expect(
			(
				await request(
					"/api/collection/settings",
					{ listCooldownSeconds: 0, detailCooldownSeconds: 0 },
					"PATCH",
				)
			).status,
		).toBe(200);
		expect((await schedule("list")).roundId).toBeNull();
		await view(pulls, true, true);
		expect(await claim("details")).toBeNull();
	});
	test("validates current-page scope, rejects generic remote mutations, and ignores a stale tab's hide event", async () => {
		const p = await project();
		const pulls = seed(p, 21);
		for (const ids of [
			["missing"],
			[pulls[0]!.id, pulls[0]!.id],
			pulls.map((pull) => pull.id),
		])
			expect(
				(
					await request("/api/collection/view", {
						viewId,
						visible: true,
						refresh: true,
						pageKey: "page",
						pullIds: ids,
					})
				).status,
			).toBe(400);
		await view(pulls.slice(0, 1), true, true);
		expect(
			(
				await request("/api/collection/view", {
					viewId: "55066675-1b8f-4bcc-9b90-4321f3950136",
					sequence: 1,
					visible: false,
					refresh: false,
					pageKey: "page",
					pullIds: [],
				})
			).status,
		).toBe(200);
		expect((await schedule("details")).roundId).not.toBeNull();
		expect(await claim("details")).not.toBeNull();
		setAccessJwtVerifierForTests(async () => ({
			email: "ada@example.com",
			name: "Ada",
			service: false,
		}));
		for (const [path, method] of [
			["/api/collection/view", "POST"],
			["/api/collector/schedule", "POST"],
			["/api/collection/refresh", "GET"],
			["/api/collection/settings", "PATCH"],
		]) {
			const res = await app.request(
				`https://signoff.hexly.ai${path}`,
				{
					method,
					headers: {
						host: "signoff.hexly.ai",
						"cf-access-jwt-assertion": "test.jwt",
					},
				},
				{
					DB: sqlite.db,
					CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
					CF_ACCESS_AUD: "aud-tag",
				},
			);
			expect(res.status).toBe(403);
		}
	});
});
