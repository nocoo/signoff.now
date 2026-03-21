import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/**
 * Resolve the working directory for a terminal session.
 *
 * Priority:
 * 1. Absolute cwdOverride that exists on disk
 * 2. Relative cwdOverride resolved against worktreePath
 * 3. worktreePath if it exists
 * 4. os.homedir() as fallback
 */
export function resolveCwd(
	cwdOverride: string | undefined,
	worktreePath: string | undefined,
): string {
	const home = homedir();

	if (cwdOverride) {
		if (isAbsolute(cwdOverride)) {
			if (existsSync(cwdOverride)) {
				return cwdOverride;
			}
			// Fall through to worktreePath or home
		} else if (worktreePath) {
			const resolved = resolve(worktreePath, cwdOverride);
			if (existsSync(resolved)) {
				return resolved;
			}
			// Fall through to worktreePath
		}
	}

	if (worktreePath && existsSync(worktreePath)) {
		return worktreePath;
	}

	return home;
}
