/**
 * The `collect` command body, as a testable function (07 §9.4).
 *
 * Living in `main.ts` it was unreachable by tests: `process.exit` ends the
 * runner, and `main.ts` is excluded from the coverage gate. Deleting either
 * guard below therefore left every test green — the guards had tests, the
 * wiring did not, and the wiring is what protects global score integrity.
 *
 * Returning an exit code instead of calling `process.exit` is the whole trick.
 */

import type { CollectOptions, CollectResult } from "../ado/collect.ts";
import type { FsLike } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { type CollectFlags, validateCollectFlags } from "./collect-flags.ts";
import { describeError, exitCodeForError } from "./exit-code-for-error.ts";

export type RunCollectDeps = {
	flags: CollectFlags;
	client: Pick<PipelineClient, "bootstrap">;
	fs: FsLike;
	dataDir: string;
	log: Logger;
	nowSeconds: number;
	collectRunId: string;
	/** Injected so a test never touches the network or the real clock. */
	collect: (opts: CollectOptions) => Promise<CollectResult>;
	makeAdoClient: () => CollectOptions["client"];
	makeWriter: () => CollectOptions["writer"];
};

export async function runCollect(deps: RunCollectDeps): Promise<number> {
	const { flags, log } = deps;

	// Validate flag combinations BEFORE any network call: a bad combination
	// should fail instantly, not after a bootstrap round trip that might itself
	// fail and mask the real problem.
	const valid = validateCollectFlags(flags);
	if (!valid.ok) {
		log.error(valid.error);
		return valid.code;
	}

	let snapshot: Awaited<ReturnType<PipelineClient["bootstrap"]>>;
	try {
		snapshot = await deps.client.bootstrap();
	} catch (e) {
		log.error(describeError(e));
		return exitCodeForError(e);
	}

	const repos = snapshot.repos
		.filter((r) => r.provider === "ado" && r.externalId)
		.filter((r) => !flags.repo || r.id === flags.repo)
		.map((r) => ({
			id: r.id,
			org: r.org,
			project: r.project,
			name: r.name,
			externalId: r.externalId as string,
			projectExternalId: r.projectExternalId as string,
		}));

	if (repos.length === 0) {
		log.error(
			flags.repo
				? `no enabled ADO repo with id ${flags.repo}`
				: "no enabled ADO repos bound; add one in the web UI first",
		);
		return ExitCode.CONTRACT;
	}

	const missingGuid = repos.filter((r) => !r.projectExternalId);
	if (missingGuid.length > 0) {
		// Work items are project-scoped; without the GUID their activities would
		// be rejected server-side (05 §5.5).
		log.error(
			`repos missing projectExternalId: ${missingGuid.map((r) => r.name).join(", ")}`,
		);
		return ExitCode.CONTRACT;
	}

	if (flags.full) {
		log.info(
			`full rematch over ${repos.length} repo(s) and their projects; scores stay stale until every scope is ingested`,
		);
	}

	let result: CollectResult;
	try {
		result = await deps.collect({
			client: deps.makeAdoClient(),
			fs: deps.fs,
			writer: deps.makeWriter(),
			dataDir: deps.dataDir,
			collectRunId: deps.collectRunId,
			nowSeconds: deps.nowSeconds,
			repos,
			developers: snapshot.developers.map((d) => ({
				id: d.id,
				alias: d.alias,
			})),
			settings: { emailSuffixes: snapshot.settings.emailSuffixes },
			since: flags.since ?? null,
			full: flags.full,
			includeWorkItems: flags.wi !== false,
			log,
		});
	} catch (e) {
		// Keep the AdoError taxonomy alive to the process boundary: "log in
		// again" and "retry later" need different responses.
		log.error(describeError(e));
		return exitCodeForError(e);
	}

	for (const sc of result.manifest.scopes) {
		for (const a of sc.artifacts) {
			log.info(`artifact ${a.path} (${a.activityCount} activities)`);
		}
	}
	log.info(`manifest ${result.manifestPath}`);
	log.info("next: signoff ingest normalized <artifact> --manifest <manifest>");

	const blocked = result.manifest.scopes.filter(
		(sc) => sc.status === "incomplete",
	);
	// The cursor is untouched by design; ingest owns the commit.
	return blocked.length > 0 ? ExitCode.CONTRACT : ExitCode.OK;
}
