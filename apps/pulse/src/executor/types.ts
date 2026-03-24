export interface ExecOptions {
	cwd?: string;
	timeoutMs?: number;
	env?: Record<string, string>;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type CommandExecutor = (
	cmd: string,
	args: readonly string[],
	opts?: ExecOptions,
) => Promise<ExecResult>;

export interface MockResponse {
	stdout: string;
	stderr?: string;
	exitCode?: number;
}
