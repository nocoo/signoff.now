import type { CommandExecutor, ExecOptions, ExecResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export function createBunExecutor(): CommandExecutor {
	return async (
		cmd: string,
		args: readonly string[],
		opts?: ExecOptions,
	): Promise<ExecResult> => {
		const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		const proc = Bun.spawn([cmd, ...args], {
			cwd: opts?.cwd,
			env: opts?.env ? { ...process.env, ...opts.env } : undefined,
			stdin:
				typeof opts?.stdin === "string" ? new Blob([opts.stdin]) : undefined,
			stdout: "pipe",
			stderr: "pipe",
		});

		const timer = setTimeout(() => {
			proc.kill();
		}, timeoutMs);

		try {
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const exitCode = await proc.exited;

			return {
				stdout: stdout.trimEnd(),
				stderr: stderr.trimEnd(),
				exitCode,
			};
		} finally {
			clearTimeout(timer);
		}
	};
}
