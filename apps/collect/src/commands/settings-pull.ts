import type { FsLike } from "../cache/bootstrap.ts";
import { writeBootstrapCache } from "../cache/bootstrap.ts";
import { ExitCode } from "../exit-codes.ts";
import type { Logger } from "../logger.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import { isPipelineClientError } from "../pipeline/client.ts";

export async function settingsPull(opts: {
	client: PipelineClient;
	fs: FsLike;
	dataDir: string;
	log: Logger;
}): Promise<number> {
	try {
		const snap = await opts.client.bootstrap();
		const path = await writeBootstrapCache(opts.fs, opts.dataDir, snap);
		opts.log.info(
			`settings pull ok: pipelineConfigVersion=${snap.settings.pipelineConfigVersion}`,
		);
		opts.log.info(`wrote ${path}`);
		opts.log.info(
			`developers=${snap.developers.length} repos=${snap.repos.length}`,
		);
		return ExitCode.OK;
	} catch (e) {
		if (isPipelineClientError(e)) {
			opts.log.error(`bootstrap failed: HTTP ${e.status}`);
			if (e.status >= 500) {
				return ExitCode.SERVER;
			}
			if (e.status === 401 || e.status === 403) {
				return ExitCode.ENV;
			}
			return ExitCode.CONTRACT;
		}
		opts.log.error(e instanceof Error ? e.message : "settings pull failed");
		return ExitCode.RUNTIME;
	}
}
