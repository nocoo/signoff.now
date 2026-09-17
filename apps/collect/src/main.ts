#!/usr/bin/env bun
/**
 * signoff collect CLI (apps/collect — temporary name; final name in 07).
 * 05: doctor / settings pull|show / collect --dry-run / ingest fixture (stub).
 */
import { Command } from "commander";
import { createBunFs } from "./cache/fs-bun.ts";
import { collectDryRun } from "./commands/collect-dry-run.ts";
import { ingestFixture } from "./commands/ingest-fixture.ts";
import { runCollect } from "./commands/run-collect.ts";
import { settingsPull } from "./commands/settings-pull.ts";
import { settingsShow } from "./commands/settings-show.ts";
import { loadEnv } from "./config/env.ts";
import { defaultExec } from "./doctor/exec-bun.ts";
import { formatDoctor, runDoctor } from "./doctor/index.ts";
import { ExitCode } from "./exit-codes.ts";
import { createLogger } from "./logger.ts";
import { createPipelineClient } from "./pipeline/client.ts";

const log = createLogger();

async function main(): Promise<void> {
	const program = new Command();
	program
		.name("signoff")
		.description("SignOff PR workbench and Azure DevOps activity collection")
		.version("0.0.1");

	const workbench = program
		.command("workbench")
		.description("Collect real pull requests into the local PR workbench");
	workbench
		.command("sync")
		.description(
			"Collect all enabled real projects; optionally add repository URLs first",
		)
		.option("--repo <urls...>", "Azure DevOps repository URLs to add and scan")
		.option("--api-base <url>", "Local Worker origin", "http://127.0.0.1:37042")
		.action(async (options: { repo?: string[]; apiBase: string }) => {
			const { createCollectionClient } = await import("./workbench/client.ts");
			const { createAdoClient } = await import("./ado/client.ts");
			const { collectProjectPulls } = await import("./workbench/ado.ts");
			const { registerRepositories, queueDueProjects, runCollectionOnce } =
				await import("./workbench/run.ts");
			const api = createCollectionClient({ apiBase: options.apiBase });
			const ado = createAdoClient({ exec: defaultExec, fetchFn: fetch });
			const ids = options.repo
				? await registerRepositories(api, options.repo)
				: undefined;
			const queued = await queueDueProjects(
				api,
				0,
				Math.floor(Date.now() / 1000),
				ids,
			);
			log.info(`Queued ${queued} project(s) for real collection.`);
			let failed = false;
			for (;;) {
				const result = await runCollectionOnce({
					api,
					ado,
					collect: collectProjectPulls,
					log,
				});
				if (result.state === "failed" || result.state === "auth_required")
					failed = true;
				if (!result.processed || result.state === "auth_required") break;
			}
			process.exitCode = failed ? ExitCode.ENV : ExitCode.OK;
		});
	workbench
		.command("watch")
		.description(
			"Keep the local collector online for UI scan requests and scheduled refreshes",
		)
		.option("--api-base <url>", "Local Worker origin", "http://127.0.0.1:37042")
		.option(
			"--interval <seconds>",
			"Minimum time between automatic project scans (30–3600)",
			"120",
		)
		.action(async (options: { apiBase: string; interval: string }) => {
			const interval = Number(options.interval);
			if (!Number.isInteger(interval) || interval < 30 || interval > 3600)
				throw new Error(
					"Scan interval must be an integer from 30 to 3600 seconds",
				);
			const { createCollectionClient } = await import("./workbench/client.ts");
			const { createAdoClient } = await import("./ado/client.ts");
			const { collectProjectPulls } = await import("./workbench/ado.ts");
			const { queueDueProjects, runCollectionOnce, collectionError } =
				await import("./workbench/run.ts");
			const api = createCollectionClient({ apiBase: options.apiBase });
			const ado = createAdoClient({ exec: defaultExec, fetchFn: fetch });
			log.info(
				`Local collector online. Automatic scans every ${interval}s; UI requests checked every 3s.`,
			);
			for (;;) {
				try {
					await queueDueProjects(api, interval);
					const result = await runCollectionOnce({
						api,
						ado,
						collect: collectProjectPulls,
						log,
					});
					if (!result.processed || result.state === "auth_required")
						await Bun.sleep(result.state === "auth_required" ? 15_000 : 3000);
				} catch (error) {
					log.error(collectionError(error).message);
					await Bun.sleep(10_000);
				}
			}
		});

	program
		.command("doctor")
		.description("Check az login, .data, bootstrap reachability, token")
		.action(async () => {
			const env = loadEnv();
			const client = createPipelineClient({
				apiBase: env.apiBase,
				writeToken: env.writeToken,
			});
			const result = await runDoctor({
				env,
				exec: defaultExec,
				fs: createBunFs(),
				client,
			});
			log.info(formatDoctor(result));
			process.exit(result.ok ? ExitCode.OK : ExitCode.ENV);
		});

	const settings = program.command("settings").description("Pipeline settings");

	settings
		.command("pull")
		.description("GET /api/pipeline/bootstrap → .data/cache/bootstrap.json")
		.action(async () => {
			const env = loadEnv();
			const code = await settingsPull({
				client: createPipelineClient({
					apiBase: env.apiBase,
					writeToken: env.writeToken,
				}),
				fs: createBunFs(),
				dataDir: env.dataDir,
				log,
			});
			process.exit(code);
		});

	settings
		.command("show")
		.description("Show cached bootstrap (or --remote refresh)")
		.option("--remote", "Refresh from API before show", false)
		.action(async (opts: { remote?: boolean }) => {
			const env = loadEnv();
			const code = await settingsShow({
				client: createPipelineClient({
					apiBase: env.apiBase,
					writeToken: env.writeToken,
				}),
				fs: createBunFs(),
				dataDir: env.dataDir,
				remote: Boolean(opts.remote),
				log,
			});
			process.exit(code);
		});

	program
		.command("collect")
		.description("Collect pull requests and work items from Azure DevOps")
		.option("--dry-run", "Print plan only; do not call ADO", false)
		.option("--repo <id>", "Only collect this repo id")
		.option("--since <date>", "Override the cursor start (ISO 8601)")
		.option("--full", "Ignore the cursor and re-collect everything", false)
		.option("--no-wi", "Skip work items")
		.action(
			async (opts: {
				dryRun?: boolean;
				repo?: string;
				since?: string;
				full?: boolean;
				wi?: boolean;
			}) => {
				const env = loadEnv();
				const fs = createBunFs();
				if (opts.dryRun) {
					const code = await collectDryRun({ fs, dataDir: env.dataDir, log });
					process.exit(code);
				}

				const { collect } = await import("./ado/collect.ts");
				const { createAdoClient } = await import("./ado/client.ts");
				const { createRawWriter } = await import("./ado/storage.ts");
				const { ulid } = await import("./ado/ulid.ts");

				const code = await runCollect({
					flags: opts,
					client: createPipelineClient({
						apiBase: env.apiBase,
						writeToken: env.writeToken,
					}),
					fs,
					dataDir: env.dataDir,
					log,
					nowSeconds: Math.floor(Date.now() / 1000),
					collectRunId: ulid(),
					collect,
					makeAdoClient: () =>
						createAdoClient({ exec: defaultExec, fetchFn: fetch as never }),
					makeWriter: () => createRawWriter(fs, env.dataDir),
				});
				process.exit(code);
			},
		);

	const ingest = program
		.command("ingest")
		.description(
			"Ingest activities into Worker.\n" +
				"SINGLE WRITER: run only one ingest at a time. Concurrent ingests can " +
				"overwrite a newer score aggregation with an older one (06 §5.7).",
		);

	ingest
		.command("normalized")
		.argument("<file>", "Path to a collect artifact under .data/normalized/")
		.requiredOption(
			"--manifest <path>",
			"Run manifest that lists this artifact",
		)
		.description("Ingest a collect artifact and commit its cursor when whole")
		.action(async (file: string, o: { manifest: string }) => {
			const env = loadEnv();
			const fs = createBunFs();
			const { ingestNormalized } = await import(
				"./commands/ingest-normalized.ts"
			);
			const { createRawWriter } = await import("./ado/storage.ts");
			const writer = createRawWriter(fs, env.dataDir);
			const bootstrap = await createPipelineClient({
				apiBase: env.apiBase,
				writeToken: env.writeToken,
			}).bootstrap();
			const code = await ingestNormalized({
				filePath: file,
				manifestPath: o.manifest,
				dataDir: env.dataDir,
				fs,
				writeJson: writer.writeJson,
				client: createPipelineClient({
					apiBase: env.apiBase,
					writeToken: env.writeToken,
				}),
				log,
				nowSeconds: Math.floor(Date.now() / 1000),
				pipelineConfigVersion: bootstrap.settings.pipelineConfigVersion,
			});
			process.exit(code);
		});

	ingest
		.command("fixture")
		.argument("<file>", "Path to fixture JSON (fixtureFileSchema)")
		.option("--dry-validate", "Validate only; do not POST", false)
		.option(
			"--complete-rematch",
			"After full_rematch ingest, call recompute/complete to clear stale",
			false,
		)
		.option("--pull", "Pull bootstrap cache before version precheck", false)
		.description("Validate fixture, chunk, and POST /api/pipeline/ingest")
		.action(
			async (
				file: string,
				opts: {
					dryValidate?: boolean;
					completeRematch?: boolean;
					pull?: boolean;
				},
			) => {
				const env = loadEnv();
				const code = await ingestFixture({
					filePath: file,
					readFile: async (p) => Bun.file(p).text(),
					log,
					client: opts.dryValidate
						? undefined
						: createPipelineClient({
								apiBase: env.apiBase,
								writeToken: env.writeToken,
							}),
					send: !opts.dryValidate,
					completeRematch: Boolean(opts.completeRematch),
					pull: Boolean(opts.pull),
					dataDir: env.dataDir,
					fs: createBunFs(),
				});
				process.exit(code);
			},
		);

	await program.parseAsync(process.argv);
}

main().catch((e) => {
	// biome-ignore lint/suspicious/noConsole: fatal CLI error path
	console.error(e);
	process.exit(ExitCode.RUNTIME);
});
