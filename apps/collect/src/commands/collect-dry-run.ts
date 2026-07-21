import type { FsLike } from "../cache/bootstrap.ts";
import { readBootstrapCache } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";

/**
 * Print collect plan from bootstrap cache. Does NOT call ADO.
 */
export async function collectDryRun(opts: {
	fs: FsLike;
	dataDir: string;
	log: Logger;
}): Promise<number> {
	const cached = await readBootstrapCache(opts.fs, opts.dataDir);
	if (!cached) {
		opts.log.error("no bootstrap cache — run `signoff settings pull` first");
		return ExitCode.CONTRACT;
	}

	const enabled = cached.repos.filter((r) => r.enabled);
	const projects = new Map<
		string,
		{
			org: string;
			project: string;
			projectGuid: string | null;
			repos: string[];
		}
	>();
	for (const r of enabled) {
		const key = `${r.provider}/${r.org}/${r.project}`;
		const cur = projects.get(key) ?? {
			org: r.org,
			project: r.project,
			projectGuid: r.projectExternalId,
			repos: [],
		};
		cur.repos.push(r.name);
		if (!cur.projectGuid && r.projectExternalId) {
			cur.projectGuid = r.projectExternalId;
		}
		projects.set(key, cur);
	}

	opts.log.info(
		`collect dry-run (pipelineConfigVersion=${cached.settings.pipelineConfigVersion})`,
	);
	opts.log.info(`enabled repos: ${enabled.length}`);
	for (const r of enabled) {
		opts.log.info(
			`  PR  ${r.org}/${r.project}/${r.name}  repoGuid=${r.externalId ?? "—"}`,
		);
	}
	opts.log.info(`distinct projects for WI: ${projects.size}`);
	for (const [, p] of projects) {
		const guid = p.projectGuid ?? "(missing project GUID — WI will be skipped)";
		opts.log.info(`  WI  ${p.org}/${p.project}  projectGuid=${guid}`);
	}
	opts.log.info("no ADO calls made (dry-run)");
	return ExitCode.OK;
}
