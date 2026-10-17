import {
	type PrSummary,
	summarizeInspection,
	summarizePull,
} from "@signoff/domain";
import {
	matchesRepositoryReference,
	parsePullReference,
	parseRepositoryReference,
} from "@signoff/domain/monitoring";
import { prCollectionsSchema } from "@signoff/domain/pr-collections";
import {
	batchCommandSchema,
	collectorQuerySchema,
	commandItemSchema,
	commandReceiptSchema,
	jobQuerySchema,
	observationDetailSchema,
	observationListSchema,
	type PullQueryItem,
	projectQuerySchema,
	pullDetailSchema,
	pullListSchema,
	repoListSchema,
} from "@signoff/domain/query";
import { projectSchema } from "@signoff/domain/workbench";
import { type Command, CommanderError, Option } from "commander";
import { z } from "zod";
import { version } from "../../../../package.json";
import { isPipelineClientError } from "../pipeline/client";
import { registerConnectorCommands } from "./connector-commands";
import { measuredAdoFetch } from "./network";
import { parsePrArgument, queryRequest, readAllPages } from "./query-client";

const cliOptionsSchema = z.object({
	apiBase: z.string().optional(),
	source: z.enum(["live", "sample"]).default("live"),
	format: z.enum(["json", "table"]).default("json"),
	pretty: z.boolean().default(false),
	summary: z.boolean().default(false),
	timeout: z.string().default("5s"),
});
type Inspection = z.infer<typeof observationListSchema>["data"][number];
const append = (value: string, values: string[]) => [...values, value];
const encode = encodeURIComponent;
function options(command: Command) {
	const result = cliOptionsSchema.parse(command.optsWithGlobals());
	const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(result.timeout);
	if (!match) throw new TypeError("Use a timeout such as 500ms, 5s, or 1m");
	const timeoutMs =
		Number(match[1]) * (match[2] === "m" ? 60000 : match[2] === "s" ? 1000 : 1);
	if (timeoutMs < 1 || timeoutMs > 300000)
		throw new TypeError("Timeout must be between 1ms and 5m");
	return { ...result, timeoutMs };
}
function print(value: unknown, command: Command) {
	const opts = options(command);
	const enriched = withSummaries(value, opts.summary);
	if (opts.format === "json") {
		process.stdout.write(
			`${JSON.stringify(enriched, null, opts.pretty ? 2 : undefined)}\n`,
		);
		return;
	}
	const obj = enriched as Record<string, unknown>;
	const data = Array.isArray(obj.data)
		? obj.data
		: Array.isArray(obj.results)
			? obj.results
			: Array.isArray(obj.jobs)
				? obj.jobs
				: [obj.data ?? obj];
	if (data.length && (data[0] as { summary?: PrSummary }).summary) {
		const rows = data.map((item) => {
			const row = item as {
				id?: string;
				number?: number;
				repository?: { name?: string } | string;
				title?: string;
				pr?: Inspection["pr"];
				watch?: Inspection["watch"];
				summary: PrSummary;
			};
			const summary = row.summary;
			const ref = row.pr ?? row;
			const repo = ref.repository;
			const ci = summary.ci.builds
				.map(
					(b) =>
						`${b.name}:${b.status}${b.stages
							.filter((s) => !["passed", "skipped"].includes(s.status))
							.map((s) => `/${s.name}:${s.status}`)
							.join("")}`,
				)
				.join("; ");
			return [
				ref.number,
				row.watch
					? row.watch.active
						? "watching"
						: "stopped"
					: summary.lifecycle,
				typeof repo === "string" ? repo : repo?.name,
				summary.lifecycle,
				summary.readiness.kind,
				summary.readiness.isCurrent ? "current" : "historical/pending",
				summary.readiness.nextAction,
				`${summary.approvals.approved ?? "?"}/${summary.approvals.required ?? "?"} (-${summary.approvals.remaining ?? "?"})`,
				`${summary.ci.status}${ci ? `: ${ci}` : ""}`,
				summary.mergeable,
				`${summary.pop.state}${summary.pop.deferred ? " (deferred)" : ""}`,
				summary.blockers
					.map(
						(b) =>
							`${b.group}${b.deferred ? " (deferred)" : ""}: ${b.name} [${b.states.join(",")}]`,
					)
					.join("; "),
				summary.updatedAt,
				ref.title,
			]
				.map((cell) => String(cell ?? "—").replace(/\p{Cc}/gu, " "))
				.join("\t");
		});
		process.stdout.write(
			`PR\tWATCH / STATE\tREPOSITORY\tLIFECYCLE\tREADINESS\tCURRENTNESS\tNEXT ACTION\tAPPROVALS\tCI\tMERGEABLE\tPOP\tBLOCKERS\tUPDATED AT\tTITLE\n${rows.join("\n")}\n`,
		);
		return;
	}
	const rows = data.map((item) => {
		const row = item as Record<string, unknown>;
		const ref = (row.pr ?? row) as Record<string, unknown>;
		const watch = row.watch as
			| { id: string; active: boolean; stopReason: string | null }
			| undefined;
		const readiness = row.readiness as { state?: string | null } | undefined;
		const repo = ref.repository as { name?: string } | undefined;
		return [
			watch?.id ??
				row.id ??
				(row.observation as { id?: string } | undefined)?.id ??
				"—",
			readiness?.state ??
				row.state ??
				row.status ??
				(watch ? (watch.active ? "watching" : "stopped") : "—"),
			repo?.name ?? "—",
			ref.number ?? "—",
			ref.title ?? row.message ?? watch?.stopReason ?? "",
		]
			.map((cell) => String(cell).replace(/\p{Cc}/gu, " "))
			.join("\t");
	});
	process.stdout.write(
		`ID\tSTATE\tREPOSITORY\tPR\tTITLE / MESSAGE\n${rows.join("\n")}\n`,
	);
}
function withSummaries(value: unknown, compact: boolean): unknown {
	const envelope = value as { data?: unknown };
	const enrich = (row: unknown) => {
		const item = row as Record<string, unknown>;
		if (!item || typeof item !== "object") return row;
		if (item.pr && item.readiness && item.checks) {
			const inspection = item as Inspection;
			const summary = summarizeInspection(inspection);
			return compact
				? {
						id: inspection.pr.id,
						number: inspection.pr.number,
						repository: inspection.pr.repository.name,
						title: inspection.pr.title,
						url: inspection.pr.url,
						summary,
					}
				: { ...item, summary };
		}
		if (item.readiness && Array.isArray(item.policies)) {
			const pull = item as PullQueryItem;
			const summary = summarizePull(pull);
			return compact
				? {
						id: pull.id,
						number: pull.number,
						repository: pull.repository.name,
						title: pull.title,
						url: pull.url,
						summary,
					}
				: { ...item, summary };
		}
		return row;
	};
	return envelope?.data === undefined
		? value
		: {
				...envelope,
				data: Array.isArray(envelope.data)
					? envelope.data.map(enrich)
					: enrich(envelope.data),
			};
}
function request(
	command: Command,
	method: string,
	path: string,
	body?: unknown,
) {
	return queryRequest(options(command), method, path, body);
}
function scope(command: Command) {
	return `source=${options(command).source}`;
}
function listOptions(command: Command) {
	return command
		.option(
			"--repo <url>",
			"Repository URL; repeat for multiple repositories",
			append,
			[],
		)
		.option("--provider <provider>", "ado or github")
		.option("--org <name>", "Organization")
		.option("--project <key>", "Project key or ID")
		.option("--limit <n>", "Page size, 1–200", "100")
		.option("--cursor <cursor>", "Continue a saved query")
		.option("--all", "Read every cached page before printing");
}
function parameters(command: Command) {
	const opts = command.optsWithGlobals();
	if (opts.all && opts.cursor)
		throw new TypeError("--all cannot be combined with --cursor");
	if (
		opts.draft === "only" &&
		opts.state &&
		!["open", "all"].includes(opts.state)
	)
		throw new TypeError("--draft only requires --state open or all");
	const query = new URLSearchParams({ source: options(command).source });
	for (const name of [
		"provider",
		"org",
		"project",
		"state",
		"draft",
		"limit",
		"cursor",
	])
		if (opts[name] !== undefined) query.set(name, String(opts[name]));
	for (const repo of opts.repo ?? []) {
		parseRepositoryReference(repo);
		query.append("repo", repo);
	}
	for (const author of opts.author ?? []) query.append("author", author);
	if (opts.watching) query.set("watching", "true");
	if (opts.includeStopped) query.set("includeStopped", "true");
	return query;
}
async function list<
	T extends {
		data: unknown[];
		page: { limit: number; total: number; nextCursor: string | null };
	},
>(command: Command, path: string, schema: z.ZodType<T>) {
	const params = parameters(command);
	if (command.opts().collection) {
		const collectionRef = String(command.opts().collection);
		const collections = prCollectionsSchema.parse(
			await request(command, "GET", `/api/pr-collections?${scope(command)}`),
		).items;
		const matches = collections.filter((c) => c.id === collectionRef);
		const resolved = matches.length
			? matches
			: collections.filter(
					(c) => c.name.toLowerCase() === collectionRef.toLowerCase(),
				);
		const selected = resolved[0];
		if (resolved.length !== 1 || !selected)
			throw new TypeError(
				resolved.length
					? "Collection name is ambiguous; use its ID"
					: "Collection not found in the selected source",
			);
		params.set("collectionId", selected.id);
	}
	const read = async (cursor?: string) => {
		const query = new URLSearchParams(params);
		if (cursor) query.set("cursor", cursor);
		return schema.parse(
			await request(command, "GET", `/api/query/v1/${path}?${query}`),
		);
	};
	print(command.opts().all ? await readAllPages(read) : await read(), command);
}
function reference(command: Command, value: string) {
	return parsePrArgument(value, command.opts().repo);
}
function lookupPath(command: Command, value: string, observation = false) {
	const ref = reference(command, value);
	if ("pullId" in ref)
		return observation
			? `observations/lookup?${scope(command)}&pullId=${encode(ref.pullId)}`
			: `prs/${encode(ref.pullId)}?${scope(command)}`;
	const parsed = parsePullReference(ref.url);
	return `${observation ? "observations" : "prs"}/lookup?${scope(command)}&repositoryUrl=${encode(parsed.repositoryUrl)}&number=${parsed.number}`;
}
function batchResult(
	value: z.infer<typeof batchCommandSchema>,
	command: Command,
) {
	print(value, command);
	if (
		value.results.some((item) =>
			["rejected", "conflict", "not_found"].includes(item.status),
		)
	) {
		process.stderr.write(
			`${JSON.stringify({ error: { code: "PARTIAL_FAILURE", message: "Some watch changes were not accepted; see individual results", retryable: false } })}\n`,
		);
		process.exitCode = 3;
	}
}
async function registerRepos(command: Command, urls: string[]) {
	if (options(command).source !== "live")
		throw new TypeError("Repository registration uses the Live source");
	const refs = urls.map(parseRepositoryReference);
	if (refs.some((ref) => ref.provider !== "ado"))
		throw new TypeError("Live GitHub collection is not available yet");
	const result = [];
	for (const ref of refs) {
		const catalog = await readAllPages(async (cursor) =>
			repoListSchema.parse(
				await request(
					command,
					"GET",
					`/api/query/v1/repos?source=live&limit=200${cursor ? `&cursor=${encode(cursor)}` : ""}`,
				),
			),
		);
		const projects = catalog.projects.filter(
			(p) =>
				p.provider === ref.provider &&
				p.organization.toLowerCase() === ref.organization.toLowerCase() &&
				p.projectKey.toLowerCase() === ref.projectKey.toLowerCase(),
		);
		if (projects.length > 1)
			throw new CommanderError(
				3,
				"REFERENCE_AMBIGUOUS",
				"Repository URL matches multiple project registrations; resolve the duplicate projects before registering this repository.",
			);
		const project = projects[0];
		const projectRepos = catalog.data.filter(
			(repo) => repo.project.id === project?.id,
		);
		const knownIds = projectRepos.flatMap((repo) =>
			repo.repository.id === null ? [] : [repo.repository.id],
		);
		if (!project) {
			result.push(
				projectSchema.parse(
					await request(command, "POST", "/api/projects", {
						provider: ref.provider,
						name: ref.projectKey.slice(0, 100),
						organization: ref.organization,
						projectKey: ref.projectKey,
						repositories: [ref.repository],
						owner: "Project maintainers",
						description: "",
						enabled: true,
					}),
				),
			);
		} else if (
			project.repositories?.length &&
			!project.repositories.some(
				(name) => name.toLowerCase() === ref.repository.toLowerCase(),
			) &&
			!projectRepos.some((repo) =>
				matchesRepositoryReference(
					repo.repository,
					ref.repository,
					ref.provider,
					knownIds,
				),
			)
		) {
			result.push(
				projectSchema.parse(
					await request(
						command,
						"PATCH",
						`/api/projects/${encode(project.id)}`,
						{
							revision: project.revision,
							repositories: [...project.repositories, ref.repository],
						},
					),
				),
			);
		} else result.push(projectQuerySchema.parse(project));
	}
	return result;
}

export function registerWorkbenchCommands(program: Command) {
	program
		.option(
			"--api-base <origin>",
			"Loopback cache service (or SIGNOFF_QUERY_API_BASE)",
		)
		.addOption(
			new Option("--source <source>", "Data source")
				.choices(["live", "sample"])
				.default("live"),
		)
		.addOption(
			new Option("--format <format>", "Output format")
				.choices(["json", "table"])
				.default("json"),
		)
		.option("--pretty", "Indent JSON output")
		.option("--summary", "Compact bot summary for PR and watch reads")
		.option("--timeout <duration>", "Cache request timeout", "5s");
	program
		.command("status")
		.description("Read cached collector and queue status; never calls Azure")
		.action(async (_opts, command) =>
			print(
				collectorQuerySchema.parse(
					await request(
						command,
						"GET",
						`/api/query/v1/collector?${scope(command)}`,
					),
				),
				command,
			),
		);
	const repos = program.command("repo").description("Registered repositories");
	listOptions(repos.command("list")).action(async (_opts, command) =>
		list(command, "repos", repoListSchema),
	);
	repos
		.command("add <urls...>")
		.description("Register repositories without discovering or watching PRs")
		.action(async (urls: string[], _opts, command) =>
			print({ data: await registerRepos(command, urls) }, command),
		);
	const prs = program.command("pr").description("Read published PR cache");
	listOptions(prs.command("list"))
		.option("--collection <name|id>", "Restrict to a cached collection")
		.addOption(
			new Option("--state <state>", "PR lifecycle")
				.choices(["open", "merged", "closed", "all"])
				.default("open"),
		)
		.addOption(
			new Option("--draft <mode>", "Draft PRs")
				.choices(["exclude", "include", "only"])
				.default("exclude"),
		)
		.option(
			"--author <key>",
			"Exact author key; repeat to include multiple",
			append,
			[],
		)
		.option("--watching", "Only watched PRs with cached results")
		.action(async (_opts, command) => list(command, "prs", pullListSchema));
	prs
		.command("get <ref>")
		.option("--repo <url>", "Repository URL for a numeric PR ref")
		.action(async (ref: string, _opts, command) =>
			print(
				pullDetailSchema.parse(
					await request(
						command,
						"GET",
						`/api/query/v1/${lookupPath(command, ref)}`,
					),
				),
				command,
			),
		);
	const watch = program
		.command("watch")
		.description("Shared web and CLI watch list");
	listOptions(watch.command("list"))
		.option("--collection <name|id>", "Restrict to a cached collection")
		.option(
			"--include-stopped",
			"Include removed and invalidated watch history",
		)
		.action(async (_opts, command) =>
			list(command, "observations", observationListSchema),
		);
	watch
		.command("add <refs...>")
		.option("--repo <url>", "Repository URL for numeric PR refs")
		.action(async (refs: string[], _opts, command) => {
			const values = refs.map((value) => reference(command, value));
			batchResult(
				batchCommandSchema.parse(
					await request(command, "POST", "/api/commands/v1/observations", {
						source: options(command).source,
						refs: values,
					}),
				),
				command,
			);
		});
	watch
		.command("remove <refs...>")
		.option("--repo <url>", "Repository URL for numeric PR refs")
		.action(async (refs: string[], _opts, command) => {
			for (const ref of refs) reference(command, ref);
			const results: z.infer<typeof batchCommandSchema>["results"] = [];
			for (const ref of refs) {
				try {
					const current = observationDetailSchema.parse(
						await request(
							command,
							"GET",
							`/api/query/v1/${lookupPath(command, ref, true)}`,
						),
					).data;
					const response = batchCommandSchema.parse(
						await request(
							command,
							"POST",
							"/api/commands/v1/observations/remove",
							{
								source: options(command).source,
								items: [
									{
										id: current.watch.id,
										generation: current.watch.generation,
									},
								],
							},
						),
					);
					results.push(...response.results);
				} catch (error) {
					if (
						!isPipelineClientError(error) ||
						![400, 404, 409, 422].includes(error.status)
					) {
						if (results.length) print({ results }, command);
						throw error;
					}
					const detail = commandItemSchema.shape.error.safeParse(
						(error.body as { error?: unknown } | null)?.error,
					);
					results.push({
						status: error.status === 404 ? "not_found" : "rejected",
						error: (detail.success && detail.data) || {
							code: error.status === 404 ? "NOT_FOUND" : "COMMAND_REJECTED",
							message:
								error.status === 404
									? `Observation not found: ${ref}`
									: error.message,
							retryable: false,
						},
					});
				}
			}
			batchResult({ results }, command);
		});
	program
		.command("discover")
		.description("Refresh all project PR states from repository lists")
		.requiredOption("--repo <url>", "Registered repository URL")
		.action(async (_opts, command) => {
			parseRepositoryReference(command.opts().repo);
			print(
				commandReceiptSchema.parse(
					await request(command, "POST", "/api/commands/v1/discover", {
						source: options(command).source,
						repositoryUrl: command.opts().repo,
					}),
				),
				command,
			);
		});
	program
		.command("refresh")
		.description("Queue checks for existing watched PRs")
		.option("--pr <ref>", "PR URL or cached ID")
		.option("--repo <url>", "All watched PRs in this repository")
		.option("--all", "All active observations")
		.action(async (_opts, command) => {
			const { pr, repo, all } = command.opts();
			if ([pr, repo, all].filter(Boolean).length !== 1)
				throw new TypeError("Choose exactly one of --pr, --repo, --all");
			if (repo) parseRepositoryReference(repo);
			const target = pr
				? parsePrArgument(pr)
				: repo
					? { repositoryUrl: repo }
					: { all: true };
			print(
				commandReceiptSchema.parse(
					await request(command, "POST", "/api/commands/v1/refresh", {
						source: options(command).source,
						target,
					}),
				),
				command,
			);
		});
	program
		.command("job")
		.command("get <id>")
		.action(async (id: string, _opts, command) =>
			print(
				jobQuerySchema.parse(
					await request(
						command,
						"GET",
						`/api/query/v1/jobs/${encode(id)}?${scope(command)}`,
					),
				),
				command,
			),
		);
	const daemon = async (command: Command) => {
		const { createCollectionClient } = await import("./client");
		const { createAdoClient } = await import("../ado/client");
		const { defaultExec } = await import("../doctor/exec-bun");
		const { watchCollections } = await import("./run");
		const { createRuntimeLogger } = await import("../runtime-log");
		const stop = new AbortController();
		const shutdown = () => stop.abort();
		let ado: ReturnType<typeof createAdoClient> | undefined;
		const { connectorStore } = await import("./connector-config");
		const { detectCapabilities } = await import("./capabilities");
		const local =
			command.opts().local === true ||
			Boolean(options(command).apiBase ?? process.env.SIGNOFF_QUERY_API_BASE);
		const connector = local ? null : connectorStore().read();
		const log = createRuntimeLogger();
		if (connector && connector.expiresAt <= Math.floor(Date.now() / 1000))
			throw new CommanderError(
				1,
				"signoff.connector",
				"Connector sign-in expired. Run: signoff connector login",
			);
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
		if (connector)
			log.info(
				`Connector ${connector.connectorId.slice(0, 8)} → ${connector.apiOrigin} as ${connector.owner}`,
			);
		const api = createCollectionClient(
			connector
				? { connector }
				: {
						apiBase:
							options(command).apiBase ?? process.env.SIGNOFF_QUERY_API_BASE,
					},
		);
		let capabilities:
			| { at: number; value: Awaited<ReturnType<typeof detectCapabilities>> }
			| undefined;
		try {
			await watchCollections({
				api,
				...(connector
					? {
							describe: async () => {
								if (!capabilities || Date.now() - capabilities.at > 300_000)
									capabilities = {
										at: Date.now(),
										value: await detectCapabilities(defaultExec),
									};
								return { capabilities: capabilities.value, version };
							},
						}
					: {}),
				makeAdo: () =>
					(ado ??= createAdoClient({
						exec: defaultExec,
						fetchFn: measuredAdoFetch(fetch, api.recordNetwork, log.warn),
					})),
				log,
				signal: stop.signal,
			});
		} finally {
			for (const signal of ["SIGINT", "SIGTERM"] as const) {
				if (process.listeners(signal).includes(shutdown))
					process.off(signal, shutdown);
			}
		}
	};
	program
		.command("daemon")
		.description(
			"Run saved discovery tasks and refresh only the shared watch list",
		)
		.option(
			"--local",
			"Use the loopback Worker even when a connector is signed in",
		)
		.action(async (_opts, command) => daemon(command));
	registerConnectorCommands(program, print);
	const legacy = program
		.command("workbench")
		.description("Compatibility aliases for the watch-list architecture");
	legacy
		.command("watch")
		.description("Alias for daemon")
		.action(async (_opts, command) => daemon(command));
	legacy
		.command("sync")
		.description(
			"Queue explicit discovery; use job get for completion (never watches PRs)",
		)
		.option("--repo <urls...>", "Repository URLs to register and discover")
		.action(async (_opts, command) => {
			const urls = command.opts().repo as string[] | undefined;
			if (urls) await registerRepos(command, urls);
			const projects = repoListSchema.parse(
				await request(command, "GET", `/api/query/v1/repos?${scope(command)}`),
			).projects;
			const receipts = [];
			if (urls)
				for (const repositoryUrl of urls)
					receipts.push(
						commandReceiptSchema.parse(
							await request(command, "POST", "/api/commands/v1/discover", {
								source: options(command).source,
								repositoryUrl,
							}),
						),
					);
			else
				for (const project of projects)
					receipts.push(
						commandReceiptSchema.parse(
							await request(command, "POST", "/api/commands/v1/discover", {
								source: options(command).source,
								projectId: project.id,
							}),
						),
					);
			print({ jobs: receipts.flatMap((receipt) => receipt.jobs) }, command);
		});
}
