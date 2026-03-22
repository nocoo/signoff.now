import type { CommandExecutor, MockResponse } from "./types.ts";

export function createMockExecutor(
	responses: Map<string, MockResponse>,
): CommandExecutor {
	return async (cmd, args) => {
		const key = [cmd, ...args].join(" ");
		const match = responses.get(key);
		if (!match) {
			throw new Error(`No mock for: ${key}`);
		}
		return {
			stdout: match.stdout,
			stderr: match.stderr ?? "",
			exitCode: match.exitCode ?? 0,
		};
	};
}
