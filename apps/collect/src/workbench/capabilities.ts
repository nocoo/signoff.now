import type { ConnectorCapabilities } from "@signoff/domain/connector";
import type { ExecFn } from "../doctor/az.ts";

async function probe(
	exec: ExecFn,
	cmd: string,
	args: string[],
): Promise<boolean | null> {
	try {
		return (await exec(cmd, args)).exitCode === 0;
	} catch {
		// Spawn failure means the tool is not installed.
		return null;
	}
}

/**
 * Local tooling reported with heartbeats so the web guide can show what is
 * missing. It never requests a new login; `az account show` only reads cache.
 */
export async function detectCapabilities(
	exec: ExecFn,
): Promise<ConnectorCapabilities> {
	const [az, gh] = await Promise.all([
		probe(exec, "az", ["account", "show", "--output", "none"]),
		probe(exec, "gh", ["auth", "status"]),
	]);
	return {
		az: { installed: az !== null, loggedIn: az === true },
		gh: { installed: gh !== null, loggedIn: gh === true },
	};
}
