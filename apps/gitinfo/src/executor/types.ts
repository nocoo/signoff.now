export interface ExecOptions {
	cwd?: string;
	timeoutMs?: number;
	env?: Record<string, string>;
	stdin?: string;
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

export interface FsReader {
	/** Check if a file or directory exists (absolute path) */
	exists(path: string): Promise<boolean>;
	/** List files in a directory, non-recursive (absolute path) */
	readdir(path: string): Promise<string[]>;
	/** Get file size in bytes (absolute path) */
	fileSize(path: string): Promise<number>;
	/** Get directory size in KiB, wraps du -sk (absolute path) */
	dirSizeKiB(path: string): Promise<number>;
}

export interface MockResponse {
	stdout: string;
	stderr?: string;
	exitCode?: number;
}
