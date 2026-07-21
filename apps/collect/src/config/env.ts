/**
 * Environment for collect CLI.
 * SIGNOFF_API_BASE — Worker origin (e.g. http://127.0.0.1:37042)
 * SIGNOFF_PIPELINE_WRITE_TOKEN — Bearer write token (not required for loopback)
 */

export type CollectEnv = {
	apiBase: string;
	writeToken: string | null;
	dataDir: string;
	/** True when API host is loopback / *.dev.hexly.ai — token always skipped. */
	isLoopback: boolean;
};

export function isLoopbackBase(apiBase: string): boolean {
	try {
		const u = new URL(apiBase);
		const h = u.hostname.toLowerCase();
		return (
			h === "localhost" ||
			h === "127.0.0.1" ||
			h === "::1" ||
			h === "[::1]" ||
			h.endsWith(".dev.hexly.ai")
		);
	} catch {
		return false;
	}
}

export function loadEnv(
	env: Record<string, string | undefined> = process.env,
	cwd: string = process.cwd(),
): CollectEnv {
	const apiBase = (env.SIGNOFF_API_BASE ?? "http://127.0.0.1:37042").replace(
		/\/+$/,
		"",
	);
	const writeToken = env.SIGNOFF_PIPELINE_WRITE_TOKEN?.trim() || null;
	const dataDir = env.SIGNOFF_DATA_DIR?.trim() || `${cwd}/.data`;
	return {
		apiBase,
		writeToken,
		dataDir,
		isLoopback: isLoopbackBase(apiBase),
	};
}

export function requireWriteToken(cfg: CollectEnv): string | null {
	if (cfg.isLoopback) {
		return null;
	}
	if (!cfg.writeToken) {
		return "SIGNOFF_PIPELINE_WRITE_TOKEN is required for non-loopback API base";
	}
	return null;
}
