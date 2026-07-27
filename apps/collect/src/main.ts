#!/usr/bin/env bun
/**
 * signoff collect CLI (apps/collect — temporary name; final name in 07).
 * 05: doctor / settings pull|show / collect --dry-run / ingest fixture (stub).
 */
import { Command } from "commander";
import { createBunFs } from "./cache/fs-bun.ts";
import { collectDryRun } from "./commands/collect-dry-run.ts";
import { validateCollectFlags } from "./commands/collect-flags.ts";
import { exitCodeForError } from "./commands/exit-code-for-error.ts";
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

				// Validate flag combinations BEFORE any network call: a bad
				// combination should fail instantly, not after a bootstrap round
				// trip that might itself fail and mask the real problem.
				const flags = validateCollectFlags(opts);
				if (!flags.ok) {
					log.error(flags.error);
					process.exit(flags.code);
				}

				const client = createPipelineClient({
					apiBase: env.apiBase,
					writeToken: env.writeToken,
				});
				const snapshot = await client.bootstrap();
				const repos = snapshot.repos
					.filter((r) => r.provider === "ado" && r.externalId)
					.filter((r) => !opts.repo || r.id === opts.repo)
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
						opts.repo
							? `no enabled ADO repo with id ${opts.repo}`
							: "no enabled ADO repos bound; add one in the web UI first",
					);
					process.exit(ExitCode.CONTRACT);
				}
				const missingGuid = repos.filter((r) => !r.projectExternalId);
				if (missingGuid.length > 0) {
					// Work items are project-scoped; without the GUID their activities
					// would be rejected server-side (05 §5.5).
					log.error(
						`repos missing projectExternalId: ${missingGuid.map((r) => r.name).join(", ")}`,
					);
					process.exit(ExitCode.CONTRACT);
				}

				if (opts.full) {
					log.info(
						`full rematch over ${repos.length} repo(s) and their projects; scores stay stale until every scope is ingested`,
					);
				}

				const { collect } = await import("./ado/collect.ts");
				const { createAdoClient } = await import("./ado/client.ts");
				const { createRawWriter } = await import("./ado/storage.ts");
				const { ulid } = await import("./ado/ulid.ts");

				const result = await collect({
					client: createAdoClient({
						exec: defaultExec,
						fetchFn: fetch as never,
					}),
					fs,
					writer: createRawWriter(fs, env.dataDir),
					dataDir: env.dataDir,
					collectRunId: ulid(),
					nowSeconds: Math.floor(Date.now() / 1000),
					repos,
					developers: snapshot.developers.map((d) => ({
						id: d.id,
						alias: d.alias,
					})),
					settings: { emailSuffixes: snapshot.settings.emailSuffixes },
					since: opts.since ?? null,
					full: opts.full,
					includeWorkItems: opts.wi !== false,
					log,
				}).catch((e: unknown) => {
					// Keep the AdoError taxonomy alive to the process boundary:
					// "log in again" and "retry later" need different responses.
					log.error(e instanceof Error ? e.message : String(e));
					process.exit(exitCodeForError(e));
				});

				const blocked = result.manifest.scopes.filter(
					(sc) => sc.status === "incomplete",
				);
				for (const sc of result.manifest.scopes) {
					for (const a of sc.artifacts) {
						log.info(`artifact ${a.path} (${a.activityCount} activities)`);
					}
				}
				log.info(`manifest ${result.manifestPath}`);
				log.info(
					"next: signoff ingest normalized <artifact> --manifest <manifest>",
				);
				// The cursor is untouched by design; ingest owns the commit.
				process.exit(blocked.length > 0 ? ExitCode.CONTRACT : ExitCode.OK);
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
