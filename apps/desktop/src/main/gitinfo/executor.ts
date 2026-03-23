/**
 * Node.js CommandExecutor implementation using `node:child_process.spawn`.
 *
 * Key contract guarantees (matching Bun executor behavior):
 * - Never rejects — always resolves with { stdout, stderr, exitCode }
 * - Returns real exit code (collectors branch on exitCode !== 0)
 * - Supports stdin piping (e.g., git cat-file --batch-check)
 * - Trims stdout/stderr trailing whitespace
 * - Timeout kills child process via SIGTERM
 */

import { spawn } from "node:child_process";
import type {
	CommandExecutor,
	ExecOptions,
	ExecResult,
} from "@signoff/gitinfo/executor";

const DEFAULT_TIMEOUT_MS = 30_000;

export function createNodeExecutor(): CommandExecutor {
	return async (
		cmd: string,
		args: readonly string[],
		opts?: ExecOptions,
	): Promise<ExecResult> => {
		const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		return new Promise((resolve) => {
			const proc = spawn(cmd, [...args], {
				cwd: opts?.cwd,
				env: opts?.env ? { ...process.env, ...opts.env } : undefined,
				stdio: [
					typeof opts?.stdin === "string" ? "pipe" : "ignore",
					"pipe",
					"pipe",
				],
				timeout: timeoutMs,
			});

			if (typeof opts?.stdin === "string" && proc.stdin) {
				proc.stdin.write(opts.stdin);
				proc.stdin.end();
			}

			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
			proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

			proc.on("close", (code) => {
				resolve({
					stdout: Buffer.concat(stdoutChunks).toString().trimEnd(),
					stderr: Buffer.concat(stderrChunks).toString().trimEnd(),
					exitCode: code ?? 1,
				});
			});

			proc.on("error", () => {
				resolve({
					stdout: Buffer.concat(stdoutChunks).toString().trimEnd(),
					stderr: Buffer.concat(stderrChunks).toString().trimEnd(),
					exitCode: 1,
				});
			});
		});
	};
}
