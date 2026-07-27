#!/usr/bin/env bun
/**
 * signoff collect CLI (apps/collect — temporary name; final name in 07).
 * 05: doctor / settings pull|show / collect --dry-run / ingest fixture (stub).
 */
import { Command } from "commander";
import { createBunFs } from "./cache/fs-bun.ts";
import { collectDryRun } from "./commands/collect-dry-run.ts";
import { ingestFixture } from "./commands/ingest-fixture.ts";
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
		.description("Local ADO collect pipeline CLI (05 skeleton)")
		.version("0.0.1");

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
		.description("Collect from ADO (05: dry-run / stub only)")
		.option("--dry-run", "Print plan only; do not call ADO", false)
		.action(async (opts: { dryRun?: boolean }) => {
			const env = loadEnv();
			if (opts.dryRun) {
				const code = await collectDryRun({
					fs: createBunFs(),
					dataDir: env.dataDir,
					log,
				});
				process.exit(code);
			}
			log.error("collect not implemented (see docs/06 / docs/07)");
			log.info("hint: use `signoff collect --dry-run` to print the plan");
			process.exit(ExitCode.RUNTIME);
		});

	const ingest = program
		.command("ingest")
		.description("Ingest activities into Worker");

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
