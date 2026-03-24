const VALID_COMMANDS = ["prs", "pr-detail"] as const;

export type Command = (typeof VALID_COMMANDS)[number];

export type PrState = "open" | "closed" | "all";

export interface ParsedArgs {
	command: Command | null;
	pretty: boolean;
	cwd: string | null;
	help: boolean;
	version: boolean;
	// prs-specific flags
	state: PrState;
	limit: number;
	author: string | null;
	noCache: boolean;
	// pr-detail-specific flags
	pr: number | null;
}

export class ArgParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArgParseError";
	}
}

const VALID_STATES: readonly PrState[] = ["open", "closed", "all"];

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

function parseStateFlag(argv: readonly string[], i: number): [PrState, number] {
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

function parsePrFlag(argv: readonly string[], i: number): [number, number] {
	const next = argv[i + 1];
	if (!next) {
		throw new ArgParseError("--pr requires a PR number");
	}
	if (!/^\d+$/.test(next)) {
		throw new ArgParseError("--pr must be a positive integer");
	}
	const num = Number.parseInt(next, 10);
	if (num <= 0) {
		throw new ArgParseError("--pr must be a positive integer");
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
		pr: null,
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
			case "--pr":
				[result.pr, i] = parsePrFlag(argv, i);
				continue;
		}

		if (arg.startsWith("-")) {
			throw new ArgParseError(`Unknown flag: ${arg}`);
		}

		if (isValidCommand(arg)) {
			if (result.command !== null) {
				throw new ArgParseError(
					`Only one command allowed, got: ${result.command}, ${arg}`,
				);
			}
			result.command = arg;
			i++;
			continue;
		}

		throw new ArgParseError(
			`Unknown command: ${arg}. Valid commands: ${VALID_COMMANDS.join(", ")}`,
		);
	}

	return result;
}

function isValidCommand(value: string): value is Command {
	return (VALID_COMMANDS as readonly string[]).includes(value);
}

function isValidState(value: string): value is PrState {
	return (VALID_STATES as readonly string[]).includes(value);
}

export function getHelpText(): string {
	return `pulse <command> [flags]

Commands:
  prs             List pull requests for the current repository
  pr-detail       Show detailed info for a single pull request

Global Flags:
  --cwd <path>    Target directory (default: cwd)
  --pretty        Human-readable output (default: compact JSON)
  --no-cache      Skip identity map cache
  --help, -h      Show help
  --version, -v   Show version

prs Flags:
  --state <s>     Filter: open, closed, all (default: open)
  --limit <n>     Max PRs to return (default: 0 = unlimited)
  --author <u>    Filter by author login

pr-detail Flags:
  --pr <n>        PR number (required)`;
}
