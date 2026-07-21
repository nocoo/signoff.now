/** Real process spawn — excluded from unit coverage. */
import type { ExecFn, ExecResult } from "./az.ts";

export const defaultExec: ExecFn = async (cmd, args): Promise<ExecResult> => {
	const proc = Bun.spawn([cmd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
};
