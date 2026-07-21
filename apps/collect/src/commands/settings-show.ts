import type { FsLike } from "../cache/bootstrap.ts";
import { readBootstrapCache, writeBootstrapCache } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { isPipelineClientError } from "../pipeline/client.ts";

export async function settingsShow(opts: {
	client: PipelineClient;
	fs: FsLike;
	dataDir: string;
	remote: boolean;
	log: Logger;
}): Promise<number> {
	try {
		if (opts.remote) {
			const snap = await opts.client.bootstrap();
			await writeBootstrapCache(opts.fs, opts.dataDir, snap);
			opts.log.info(JSON.stringify(snap, null, 2));
			return ExitCode.OK;
		}
		const cached = await readBootstrapCache(opts.fs, opts.dataDir);
		if (!cached) {
			opts.log.error(
				"no bootstrap cache — run `signoff settings pull` first (or --remote)",
			);
			return ExitCode.CONTRACT;
		}
		opts.log.info(
			`pipelineConfigVersion=${cached.settings.pipelineConfigVersion}`,
		);
		opts.log.info(`timezone=${cached.settings.timezone}`);
		opts.log.info(`emailSuffixes=${cached.settings.emailSuffixes.join(",")}`);
		opts.log.info(
			`developers=${cached.developers.length} repos=${cached.repos.length}`,
		);
		opts.log.info(`cachedAt=${cached.cachedAt}`);
		opts.log.info(`fetchedAt=${cached.fetchedAt}`);
		return ExitCode.OK;
	} catch (e) {
		if (isPipelineClientError(e)) {
			opts.log.error(`remote bootstrap failed: HTTP ${e.status}`);
			return e.status >= 500 ? ExitCode.SERVER : ExitCode.CONTRACT;
		}
		opts.log.error(e instanceof Error ? e.message : "settings show failed");
		return ExitCode.RUNTIME;
	}
}
