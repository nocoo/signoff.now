#!/usr/bin/env bun

import { GitHubClient } from "./api/github-client.ts";
import { ArgParseError, getHelpText, parseArgs } from "./cli/args.ts";
import { formatOutput } from "./cli/output.ts";
import { fetchPrDetail } from "./commands/pr-detail/fetch-pr-detail.ts";
import { fetchPrDiff } from "./commands/pr-diff/fetch-pr-diff.ts";
import { fetchPrs } from "./commands/prs/fetch-prs.ts";
import { createBunExecutor } from "./executor/bun-executor.ts";
import { createFsCacheStore } from "./identity/fs-cache-store.ts";
import { parseRemoteUrl } from "./identity/resolve-remote.ts";
import { resolveIdentity } from "./identity/resolve-user.ts";

const VERSION = "0.1.0";

async function main(): Promise<void> {
	let args: ReturnType<typeof parseArgs>;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		if (err instanceof ArgParseError) {
			console.error(`error: ${err.message}`);
			process.exit(1);
		}
		throw err;
	}

	if (args.help) {
		console.log(getHelpText());
		return;
	}

	if (args.version) {
		console.log(VERSION);
		return;
	}

	if (!args.command) {
		console.error("error: no command specified\n");
		console.error(getHelpText());
		process.exit(1);
	}

	const exec = createBunExecutor();
	const cwd = args.cwd ?? process.cwd();

	// Step 1: Get the remote URL
	const remoteResult = await exec("git", ["remote", "get-url", "origin"], {
		cwd,
	});
	if (remoteResult.exitCode !== 0) {
		console.error(
			"error: could not read git remote. Is this a git repository?",
		);
		process.exit(1);
	}

	// Step 2: Parse remote URL
	const remote = parseRemoteUrl(remoteResult.stdout.trim());

	if (remote.platform === "azure-devops") {
		console.error("error: Azure DevOps is not supported yet");
		process.exit(1);
	}

	if (remote.platform === "unknown" || !remote.owner || !remote.repo) {
		console.error(
			`error: could not parse remote URL: ${remoteResult.stdout.trim()}`,
		);
		process.exit(1);
	}

	// Step 3: Resolve identity
	const cacheStore = args.noCache ? undefined : createFsCacheStore();
	const identity = await resolveIdentity(exec, remote.host, remote.owner, {
		noCache: args.noCache,
		cacheStore,
	});

	if (!identity) {
		console.error(
			"error: no authenticated GitHub user found. Run: gh auth login",
		);
		process.exit(1);
	}

	// Step 4: Dispatch to subcommand
	const client = new GitHubClient(identity.token);

	switch (args.command) {
		case "prs": {
			const report = await fetchPrs(client, {
				owner: remote.owner,
				repo: remote.repo,
				state: args.state,
				limit: args.limit,
				author: args.author,
				resolvedUser: identity.login,
				resolvedVia: identity.resolvedVia,
			});

			console.log(formatOutput(report, args.pretty));
			break;
		}

		case "pr show": {
			if (args.number === null) {
				console.error("error: --number <n> is required for pr show command");
				process.exit(1);
			}

			const report = await fetchPrDetail(client, {
				owner: remote.owner,
				repo: remote.repo,
				number: args.number,
				resolvedUser: identity.login,
				resolvedVia: identity.resolvedVia,
			});

			console.log(formatOutput(report, args.pretty));
			break;
		}

		case "pr diff": {
			if (args.number === null) {
				console.error("error: --number <n> is required for pr diff command");
				process.exit(1);
			}

			const report = await fetchPrDiff(client, {
				owner: remote.owner,
				repo: remote.repo,
				number: args.number,
				resolvedUser: identity.login,
				resolvedVia: identity.resolvedVia,
			});

			console.log(formatOutput(report, args.pretty));
			break;
		}
	}
}

main().catch((err) => {
	console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
