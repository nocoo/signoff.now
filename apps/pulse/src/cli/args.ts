import type { PullRequestStateFilter } from "../commands/types.ts";

/** Top-level commands recognised by the parser. */
const SIMPLE_COMMANDS = ["prs"] as const;

/** Two-token sub-actions under the `pr` prefix. */
const PR_ACTIONS = ["show", "diff"] as const;

type SimpleCommand = (typeof SIMPLE_COMMANDS)[number];
type PrAction = (typeof PR_ACTIONS)[number];

export type Command = SimpleCommand | `pr ${PrAction}`;

export interface ParsedArgs {
	command: Command | null;
	pretty: boolean;
	cwd: string | null;
	help: boolean;
	version: boolean;
	// prs-specific flags
	state: PullRequestStateFilter;
	limit: number;
	author: string | null;
	noCache: boolean;
	// pr show-specific flags
	number: number | null;
}

export class ArgParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArgParseError";
	}
}

const VALID_STATES: readonly PullRequestStateFilter[] = [
	"open",
	"closed",
	"merged",
	"all",
];

/** Consume a required next-arg value, throwing if missing or looks like a flag. */
function consumeValue(
	argv: readonly string[],
	i: number,
	flagName: string,
): string {
	const next = argv[i];
	if (!next || next.startsWith("-")) {
		throw new ArgParseError(`${flagName} requires a value`);
	}
	return next;
}

function parseCwdFlag(argv: readonly string[], i: number): [string, number] {
	const value = consumeValue(argv, i + 1, "--cwd");
	return [value, i + 2];
}

function parseStateFlag(
	argv: readonly string[],
	i: number,
): [PullRequestStateFilter, number] {
	const next = argv[i + 1];
	if (!next || !isValidState(next)) {
		throw new ArgParseError(
			`--state requires one of: ${VALID_STATES.join(", ")}`,
		);
	}
	return [next, i + 2];
}

function parseLimitFlag(argv: readonly string[], i: number): [number, number] {
	const next = argv[i + 1];
	if (!next) {
		throw new ArgParseError("--limit requires a number");
	}
	// Strict integer check: reject "1foo", "1.5", etc.
	if (!/^\d+$/.test(next)) {
		throw new ArgParseError("--limit must be a non-negative integer");
	}
	const num = Number.parseInt(next, 10);
	return [num, i + 2];
}

function parseAuthorFlag(argv: readonly string[], i: number): [string, number] {
	const value = consumeValue(argv, i + 1, "--author");
	return [value, i + 2];
}

function parseNumberFlag(argv: readonly string[], i: number): [number, number] {
	const next = argv[i + 1];
	if (!next) {
		throw new ArgParseError("--number requires a PR number");
	}
	if (!/^\d+$/.test(next)) {
		throw new ArgParseError("--number must be a positive integer");
	}
	const num = Number.parseInt(next, 10);
	if (num <= 0) {
		throw new ArgParseError("--number must be a positive integer");
	}
	return [num, i + 2];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
	const result: ParsedArgs = {
		command: null,
		pretty: false,
		cwd: null,
		help: false,
		version: false,
		state: "open",
		limit: 0,
		author: null,
		noCache: false,
		number: null,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i] as string;

		switch (arg) {
			case "--help":
			case "-h":
				result.help = true;
				i++;
				continue;
			case "--version":
			case "-v":
				result.version = true;
				i++;
				continue;
			case "--pretty":
				result.pretty = true;
				i++;
				continue;
			case "--no-cache":
				result.noCache = true;
				i++;
				continue;
			case "--cwd":
				[result.cwd, i] = parseCwdFlag(argv, i);
				continue;
			case "--state":
				[result.state, i] = parseStateFlag(argv, i);
				continue;
			case "--limit":
				[result.limit, i] = parseLimitFlag(argv, i);
				continue;
			case "--author":
				[result.author, i] = parseAuthorFlag(argv, i);
				continue;
			case "--number":
				[result.number, i] = parseNumberFlag(argv, i);
				continue;
		}

		if (arg.startsWith("-")) {
			throw new ArgParseError(`Unknown flag: ${arg}`);
		}

		// Command parsing
		if (result.command !== null) {
			throw new ArgParseError(
				`Only one command allowed, got: ${result.command}, ${arg}`,
			);
		}

		if (isSimpleCommand(arg)) {
			result.command = arg;
			i++;
			continue;
		}

		// Two-token commands: "pr show"
		if (arg === "pr") {
			const action = argv[i + 1];
			if (!action || !isPrAction(action)) {
				const validActions = PR_ACTIONS.join(", ");
				throw new ArgParseError(`pr requires a sub-action: ${validActions}`);
			}
			result.command = `pr ${action}`;
			i += 2;
			continue;
		}

		throw new ArgParseError(
			`Unknown command: ${arg}. Valid commands: prs, pr show`,
		);
	}

	return result;
}

function isSimpleCommand(value: string): value is SimpleCommand {
	return (SIMPLE_COMMANDS as readonly string[]).includes(value);
}

function isPrAction(value: string): value is PrAction {
	return (PR_ACTIONS as readonly string[]).includes(value);
}

function isValidState(value: string): value is PullRequestStateFilter {
	return (VALID_STATES as readonly string[]).includes(value);
}

export function getHelpText(): string {
	return `pulse <command> [flags]

Commands:
  prs             List pull requests for the current repository
  pr show         Show detailed info for a single pull request
  pr diff         Show diff and changed files for a single PR

Global Flags:
  --cwd <path>    Target directory (default: cwd)
  --pretty        Human-readable output (default: compact JSON)
  --no-cache      Skip identity map cache
  --help, -h      Show help
  --version, -v   Show version

prs Flags:
  --state <s>     Filter: open, closed, merged, all (default: open)
  --limit <n>     Max PRs to return (default: 0 = unlimited)
  --author <u>    Filter by author login

pr show Flags:
  --number <n>    PR number (required)

pr diff Flags:
  --number <n>    PR number (required)`;
}
