/**
 * `signoff collect` — the real ADO path (07 §3, §7).
 *
 * Sequencing matters more than the code here:
 *
 *   watermark BEFORE fetching → fetch → snapshot → transform → write artifacts
 *   → write a manifest whose scopes are all `pending`
 *
 * The cursor is deliberately NOT advanced. Collection cannot know whether the
 * data reached D1; only `ingest normalized` can, so it owns the commit
 * (07 §7.1.2). A run that leaves the cursor untouched is behaving correctly,
 * not half-finished.
 */

import {
	adoListSchema,
	type Cursor,
	cursorSchema,
	emptyCursor,
	MANIFEST_SCHEMA_VERSION,
	type Manifest,
	planWindow,
	rawIterationSchema,
	rawThreadSchema,
	rawWiUpdateSchema,
	rawWorkItemSchema,
	readCursor,
	type Scope,
	transformPullRequests,
	transformWorkItems,
} from "@signoff/domain";
import type { FsLike } from "../cache/bootstrap.ts";
import { type AdoClient, adoUrl } from "./client.ts";
import {
	fetchAllPages,
	fetchPullRequests,
	fetchWorkItemIds,
	type PageProblem,
} from "./paging.ts";
import { type RawWriter, serializeJson, sha256Hex } from "./storage.ts";
import { derivedUlid } from "./ulid.ts";

export type CollectRepo = {
	id: string;
	org: string;
	project: string;
	name: string;
	externalId: string;
	projectExternalId: string;
};

export type CollectOptions = {
	client: AdoClient;
	fs: FsLike;
	writer: RawWriter;
	dataDir: string;
	collectRunId: string;
	nowSeconds: number;
	repos: readonly CollectRepo[];
	developers: readonly { id: string; alias: string }[];
	settings: { emailSuffixes: readonly string[] };
	since?: string | null;
	full?: boolean;
	includeWorkItems?: boolean;
	/** Only warnings: collection reports blockers, the CLI prints the rest. */
	log?: { warn: (m: string) => void };
};

export type CollectResult = {
	manifest: Manifest;
	manifestPath: string;
};

const projectBase = (org: string, project: string) =>
	`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/`;

export async function readCursorFile(
	fs: FsLike,
	dataDir: string,
): Promise<Cursor> {
	try {
		const raw = await fs.readFile(`${dataDir}/meta/cursor.json`);
		return cursorSchema.parse(JSON.parse(raw));
	} catch {
		// A missing or unreadable cursor means "collect everything", which is
		// safe; the alternative (guessing a start point) would skip history.
		return emptyCursor();
	}
}

async function collectRepo(
	opts: CollectOptions,
	repo: CollectRepo,
	cursor: Cursor,
): Promise<{ scope: Scope; artifactBody: unknown | null }> {
	const base = projectBase(repo.org, repo.project);
	const repoPath = `_apis/git/repositories/${encodeURIComponent(repo.name)}`;
	const baseCursor = readCursor(cursor, { kind: "repo", id: repo.id });
	const window = planWindow({
		baseCursor,
		nowSeconds: opts.nowSeconds,
		since: opts.since ?? null,
		full: opts.full,
	});

	const scope: Scope = {
		kind: "repo",
		id: repo.id,
		field: "prsClosedThrough",
		baseCursor,
		from: window.from,
		watermark: window.watermark,
		commitEligible: window.commitEligible,
		status: "pending",
		errors: [],
		artifacts: [],
	};

	const problems: PageProblem[] = [];
	const prs = [];
	// One request per status: `searchCriteria.status` takes a single value, and
	// omitting `abandoned` would mean pr.closed never exists.
	for (const status of ["completed", "abandoned", "active"] as const) {
		const page = await fetchPullRequests({
			client: opts.client,
			base,
			repoPath,
			status,
			from: status === "active" ? null : window.from,
			watermark: status === "active" ? undefined : window.watermark,
		});
		problems.push(...page.problems);
		prs.push(...page.items);
	}

	const threadsByPr = new Map();
	const iterationsByPr = new Map();
	for (const pr of prs) {
		const id = pr.pullRequestId;
		const threads = adoListSchema(rawThreadSchema).parse(
			await opts.client.get(
				adoUrl(base, `${repoPath}/pullRequests/${id}/threads`),
			),
		).value;
		const iterations = adoListSchema(rawIterationSchema).parse(
			await opts.client.get(
				adoUrl(base, `${repoPath}/pullRequests/${id}/iterations`),
			),
		).value;
		threadsByPr.set(id, threads);
		iterationsByPr.set(id, iterations);

		const dir = `${opts.dataDir}/raw/ado/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}/repos/${encodeURIComponent(repo.name)}`;
		const snap = {
			fetchedAt: opts.nowSeconds,
			collectRunId: opts.collectRunId,
			entityId: id,
		};
		await opts.writer.writeSnapshot({
			...snap,
			dir: `${dir}/prs`,
			payload: pr,
		});
		await opts.writer.writeSnapshot({
			...snap,
			dir: `${dir}/pr-threads`,
			payload: threads,
		});
		await opts.writer.writeSnapshot({
			...snap,
			dir: `${dir}/pr-iterations`,
			payload: iterations,
		});
	}

	const result = transformPullRequests({
		settings: { emailSuffixes: opts.settings.emailSuffixes },
		developers: opts.developers,
		org: repo.org,
		project: repo.project,
		repo: { id: repo.id, externalId: repo.externalId },
		projectExternalId: repo.projectExternalId,
		prs,
		threadsByPr,
		iterationsByPr,
	});

	// Any gap in coverage poisons the whole scope: emitting the rest and
	// advancing the cursor would skip the missing part forever (07 §5).
	const errors = [...problems.map((p) => p.reason), ...result.anomalies];
	if (errors.length > 0) {
		return {
			scope: { ...scope, status: "incomplete", errors },
			artifactBody: null,
		};
	}

	return {
		scope,
		artifactBody: {
			activities: result.activities,
			unmatched: result.unmatched,
			skipped: result.skipped,
		},
	};
}

async function collectProject(
	opts: CollectOptions,
	repo: CollectRepo,
	cursor: Cursor,
): Promise<{ scope: Scope; artifactBody: unknown | null }> {
	const base = projectBase(repo.org, repo.project);
	const baseCursor = readCursor(cursor, {
		kind: "project",
		id: repo.projectExternalId,
	});
	const window = planWindow({
		baseCursor,
		nowSeconds: opts.nowSeconds,
		since: opts.since ?? null,
		full: opts.full,
	});

	const scope: Scope = {
		kind: "project",
		id: repo.projectExternalId,
		field: "wiChangedThrough",
		baseCursor,
		from: window.from,
		watermark: window.watermark,
		commitEligible: window.commitEligible,
		status: "pending",
		errors: [],
		artifacts: [],
	};

	const idPage = await fetchWorkItemIds({
		client: opts.client,
		base,
		project: repo.project,
		from: window.from,
		watermark: window.watermark,
	});
	const problems = [...idPage.problems];

	const workItems = [];
	const updatesByWi = new Map();
	const types = new Set<string>();
	for (const id of idPage.items) {
		const item = rawWorkItemSchema.parse(
			await opts.client.get(adoUrl(base, `_apis/wit/workitems/${id}`)),
		);
		workItems.push(item);
		const type = item.fields["System.WorkItemType"];
		if (typeof type === "string") {
			types.add(type);
		}

		const updates = await fetchAllPages(
			opts.client,
			(skip) =>
				adoUrl(base, `_apis/wit/workItems/${id}/updates`, { $skip: skip }),
			(raw) => adoListSchema(rawWiUpdateSchema).parse(raw).value,
			// `rev` is not unique in live data; `id` is the real key (07 §6.2.3).
			(u) => u.id ?? `${u.rev}`,
		);
		problems.push(...updates.problems);
		updatesByWi.set(id, updates.items);

		const dir = `${opts.dataDir}/raw/ado/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}`;
		const snap = {
			fetchedAt: opts.nowSeconds,
			collectRunId: opts.collectRunId,
			entityId: id,
		};
		await opts.writer.writeSnapshot({
			...snap,
			dir: `${dir}/workitems`,
			payload: item,
		});
		await opts.writer.writeSnapshot({
			...snap,
			dir: `${dir}/workitem-updates`,
			payload: updates.items,
		});
	}

	// Closure is decided by state CATEGORY, never by state name, so the caller
	// must resolve the map — the transform is pure and cannot ask the API.
	const stateCategories = new Map<string, Map<string, string>>();
	for (const type of types) {
		const res = (await opts.client.get(
			adoUrl(
				base,
				`_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`,
			),
		)) as { value?: { name?: string; category?: string }[] };
		stateCategories.set(
			type,
			new Map(
				(res.value ?? [])
					.filter((s) => s.name && s.category)
					.map((s) => [s.name as string, s.category as string]),
			),
		);
	}

	const result = transformWorkItems({
		settings: { emailSuffixes: opts.settings.emailSuffixes },
		developers: opts.developers,
		org: repo.org,
		project: repo.project,
		projectExternalId: repo.projectExternalId,
		workItems,
		updatesByWi,
		stateCategories,
	});

	const errors = [...problems.map((p) => p.reason), ...result.anomalies];
	if (errors.length > 0) {
		return {
			scope: { ...scope, status: "incomplete", errors },
			artifactBody: null,
		};
	}

	return {
		scope,
		artifactBody: {
			activities: result.activities,
			unmatched: result.unmatched,
			skipped: result.skipped,
		},
	};
}

export async function collect(opts: CollectOptions): Promise<CollectResult> {
	const cursor = await readCursorFile(opts.fs, opts.dataDir);
	const scopes: Scope[] = [];

	for (const repo of opts.repos) {
		const { scope, artifactBody } = await collectRepo(opts, repo, cursor);
		if (artifactBody) {
			const path = `${opts.dataDir}/normalized/ado/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}/repo-${encodeURIComponent(repo.id)}-${opts.collectRunId}.json`;
			await opts.writer.writeJson(path, artifactBody);
			const count = (artifactBody as { activities: unknown[] }).activities
				.length;
			scope.artifacts.push({
				path,
				runId: derivedUlid(opts.collectRunId, scopes.length),
				sha256: await sha256Hex(serializeJson(artifactBody)),
				activityCount: count,
				status: "pending",
			});
		}
		scopes.push(scope);
	}

	if (opts.includeWorkItems !== false) {
		// Work items belong to a project; collecting once per repo would fetch
		// the same items repeatedly (01 §7.2).
		const seenProjects = new Set<string>();
		for (const repo of opts.repos) {
			if (seenProjects.has(repo.projectExternalId)) {
				continue;
			}
			seenProjects.add(repo.projectExternalId);
			const { scope, artifactBody } = await collectProject(opts, repo, cursor);
			if (artifactBody) {
				const path = `${opts.dataDir}/normalized/ado/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}/project-${opts.collectRunId}.json`;
				await opts.writer.writeJson(path, artifactBody);
				const count = (artifactBody as { activities: unknown[] }).activities
					.length;
				scope.artifacts.push({
					path,
					runId: derivedUlid(opts.collectRunId, 1000 + scopes.length),
					sha256: await sha256Hex(serializeJson(artifactBody)),
					activityCount: count,
					status: "pending",
				});
			}
			scopes.push(scope);
		}
	}

	const manifest: Manifest = {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		collectRunId: opts.collectRunId,
		startedAt: opts.nowSeconds,
		scopes,
	};
	const manifestPath = `${opts.dataDir}/meta/runs/${opts.collectRunId}.json`;
	await opts.writer.writeJson(manifestPath, manifest);

	for (const s of scopes) {
		if (s.status === "incomplete") {
			opts.log?.warn(
				`scope ${s.kind}:${s.id} is incomplete and will not advance the cursor — ${s.errors[0]}`,
			);
		} else if (!s.commitEligible) {
			opts.log?.warn(
				`scope ${s.kind}:${s.id} starts after the committed cursor; ingest will not advance it`,
			);
		}
	}

	return { manifest, manifestPath };
}
