/** Real process spawn — excluded from unit coverage. Runs under Bun and Node. */
import { spawn } from "node:child_process";
import type { ExecFn, ExecResult } from "./az.ts";

export const defaultExec: ExecFn = (cmd, args): Promise<ExecResult> =>
	new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (exitCode) =>
			resolve({ exitCode: exitCode ?? 1, stdout, stderr }),
		);
	});
