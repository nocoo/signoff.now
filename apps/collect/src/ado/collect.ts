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
	FIXTURE_FILE_MAX_ACTIVITIES,
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

export type ArtifactBody = {
	activities: unknown[];
	unmatched: unknown[];
	skipped: Record<string, number>;
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
): Promise<{ scope: Scope; artifactBody: ArtifactBody | null }> {
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
		// `--full` re-reads the whole history, so the server must re-match every
		// activity rather than merge into what is already stored (06 §8).
		fullRematch: opts.full === true,
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
): Promise<{ scope: Scope; artifactBody: ArtifactBody | null }> {
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
		// `--full` re-reads the whole history, so the server must re-match every
		// activity rather than merge into what is already stored (06 §8).
		fullRematch: opts.full === true,
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

/**
 * Write a scope's activities, splitting at the fixture cap.
 *
 * `fixtureFileSchema` allows at most 5000 activities per file, so a busy window
 * has to become several artifacts. Each gets its own run id — the server treats
 * them as independent runs and would otherwise see the second file's chunk 0 as
 * a duplicate of the first's. The scope only commits once ALL of them land.
 */
async function writeArtifacts(
	opts: CollectOptions,
	scope: Scope,
	body: ArtifactBody,
	target: { dir: string; stem: string },
	nextArtifactIndex: () => number,
): Promise<void> {
	const parts: ArtifactBody[] = [];
	for (
		let i = 0;
		i < body.activities.length;
		i += FIXTURE_FILE_MAX_ACTIVITIES
	) {
		parts.push({
			activities: body.activities.slice(i, i + FIXTURE_FILE_MAX_ACTIVITIES),
			// Unmatched identities and counters belong to the window, not to a
			// slice, so they ride on the first file only — repeating them would
			// inflate seen_count once per part.
			unmatched: i === 0 ? body.unmatched : [],
			skipped: i === 0 ? body.skipped : {},
		});
	}
	if (parts.length === 0) {
		parts.push({
			activities: [],
			unmatched: body.unmatched,
			skipped: body.skipped,
		});
	}

	for (const [i, part] of parts.entries()) {
		const suffix = parts.length === 1 ? "" : `-${i}`;
		const path = `${target.dir}/${target.stem}-${opts.collectRunId}${suffix}.json`;
		await opts.writer.writeJson(path, part);
		scope.artifacts.push({
			path,
			runId: derivedUlid(opts.collectRunId, nextArtifactIndex()),
			sha256: await sha256Hex(serializeJson(part)),
			activityCount: part.activities.length,
			status: "pending",
		});
	}
}

export async function collect(opts: CollectOptions): Promise<CollectResult> {
	const cursor = await readCursorFile(opts.fs, opts.dataDir);
	const scopes: Scope[] = [];
	// A single monotonic counter across the whole run. Indexing by scope would
	// let scope 1's first artifact reuse scope 0's second run id, and the server
	// would then read a fresh chunk 0 as a duplicate of a finalized run.
	let artifactIndex = 0;
	const nextArtifactIndex = () => artifactIndex++;

	for (const repo of opts.repos) {
		const { scope, artifactBody } = await collectRepo(opts, repo, cursor);
		if (artifactBody) {
			await writeArtifacts(
				opts,
				scope,
				artifactBody,
				{
					dir: `${opts.dataDir}/normalized/ado/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}`,
					stem: `repo-${encodeURIComponent(repo.id)}`,
				},
				nextArtifactIndex,
			);
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
				await writeArtifacts(
					opts,
					scope,
					artifactBody,
					{
						dir: `${opts.dataDir}/normalized/ado/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}`,
						stem: "project",
					},
					nextArtifactIndex,
				);
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
