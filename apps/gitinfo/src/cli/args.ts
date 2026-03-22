const VALID_SECTIONS = [
	"meta",
	"branches",
	"status",
	"logs",
	"contributors",
	"tags",
	"files",
	"config",
] as const;

export type Section = (typeof VALID_SECTIONS)[number];

export interface ParsedArgs {
	section: Section | null;
	full: boolean;
	pretty: boolean;
	cwd: string | null;
	help: boolean;
	version: boolean;
}

export class ArgParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArgParseError";
	}
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
	const result: ParsedArgs = {
		section: null,
		full: false,
		pretty: false,
		cwd: null,
		help: false,
		version: false,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i] as string;

		if (arg === "--help" || arg === "-h") {
			result.help = true;
			i++;
			continue;
		}

		if (arg === "--version" || arg === "-v") {
			result.version = true;
			i++;
			continue;
		}

		if (arg === "--full") {
			result.full = true;
			i++;
			continue;
		}

		if (arg === "--pretty") {
			result.pretty = true;
			i++;
			continue;
		}

		if (arg === "--cwd") {
			i++;
			const next = argv[i];
			if (!next || next.startsWith("-")) {
				throw new ArgParseError("--cwd requires a path argument");
			}
			result.cwd = next;
			i++;
			continue;
		}

		if (arg.startsWith("-")) {
			throw new ArgParseError(`Unknown flag: ${arg}`);
		}

		if (isValidSection(arg)) {
			if (result.section !== null) {
				throw new ArgParseError(
					`Only one section allowed, got: ${result.section}, ${arg}`,
				);
			}
			result.section = arg;
			i++;
			continue;
		}

		throw new ArgParseError(
			`Unknown section: ${arg}. Valid sections: ${VALID_SECTIONS.join(", ")}`,
		);
	}

	return result;
}

function isValidSection(value: string): value is Section {
	return (VALID_SECTIONS as readonly string[]).includes(value);
}

export function getHelpText(): string {
	return `gitinfo [section] [flags]

Sections:
  (none)          Full report (all sections)
  meta            Repository metadata
  branches        Branch information
  status          Working tree status
  logs            Commit history
  contributors    Author statistics
  tags            Tags & releases
  files           File statistics
  config          Git configuration

Flags:
  --full          Include slow-tier data (per-author LOC, blob sizes, file churn)
  --pretty        Human-readable output (default: compact JSON)
  --cwd <path>    Target directory (default: cwd)
  --help, -h      Show help
  --version, -v   Show version`;
}
