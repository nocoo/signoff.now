/** Exit codes (§9.4). */
export const ExitCode = {
	OK: 0,
	RUNTIME: 1,
	ENV: 2,
	CONTRACT: 3,
	SERVER: 4,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
