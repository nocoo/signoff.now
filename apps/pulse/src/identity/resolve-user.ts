import type { CommandExecutor } from "../executor/types.ts";
import type {
	GhAuthEntry,
	IdentityMapCache,
	ResolvedIdentity,
} from "./types.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CacheStore {
	read(): Promise<IdentityMapCache | null>;
	write(cache: IdentityMapCache): Promise<void>;
}

/**
 * List all authenticated GitHub users from `gh auth status`.
 */
export async function listGhUsers(
	exec: CommandExecutor,
): Promise<GhAuthEntry[]> {
	const result = await exec("gh", ["auth", "status", "--json", "hosts"]);
	if (result.exitCode !== 0) {
		return [];
	}

	try {
		const data = JSON.parse(result.stdout) as {
			hosts: Record<
				string,
				Array<{ login: string; active: boolean; host: string }>
			>;
		};
		const entries: GhAuthEntry[] = [];
		for (const [host, users] of Object.entries(data.hosts)) {
			for (const user of users) {
				entries.push({ login: user.login, active: user.active, host });
			}
		}
		return entries;
	} catch {
		return [];
	}
}

/**
 * Get the token for a specific gh user.
 */
export async function getTokenForUser(
	exec: CommandExecutor,
	login: string,
): Promise<string | null> {
	const result = await exec("gh", ["auth", "token", "--user", login]);
	if (result.exitCode !== 0 || !result.stdout) {
		return null;
	}
	return result.stdout;
}

/**
 * Query org memberships for a user using their token.
 */
export async function getOrgsForUser(
	exec: CommandExecutor,
	token: string,
): Promise<string[]> {
	const result = await exec("gh", ["api", "/user/orgs", "--jq", ".[].login"], {
		env: { GH_TOKEN: token },
	});
	if (result.exitCode !== 0) {
		return [];
	}
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

/**
 * Build the complete owner→user identity map.
 */
export async function buildIdentityMap(
	exec: CommandExecutor,
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	const users = await listGhUsers(exec);

	for (const user of users) {
		// Each user maps to themselves
		map.set(user.login, user.login);

		// Query their orgs
		const token = await getTokenForUser(exec, user.login);
		if (token) {
			const orgs = await getOrgsForUser(exec, token);
			for (const org of orgs) {
				// First user to claim an org wins (deterministic by iteration order)
				if (!map.has(org)) {
					map.set(org, user.login);
				}
			}
		}
	}

	return map;
}

/**
 * Parse a cached identity map, checking TTL.
 */
export function parseCachedMap(
	cache: IdentityMapCache | null,
	now: number = Date.now(),
): Map<string, string> | null {
	if (!cache) return null;

	const age = now - new Date(cache.createdAt).getTime();
	if (age > CACHE_TTL_MS) return null;

	const map = new Map<string, string>();
	for (const entry of cache.entries) {
		map.set(entry.owner, entry.ghUser);
	}
	return map;
}

/**
 * Serialize an identity map to cache format.
 */
export function serializeMap(map: Map<string, string>): IdentityMapCache {
	return {
		entries: [...map.entries()].map(([owner, ghUser]) => ({ owner, ghUser })),
		createdAt: new Date().toISOString(),
	};
}

/**
 * Resolve the correct GitHub identity for a given owner.
 * Uses cache when available, builds fresh map otherwise.
 */
export async function resolveIdentity(
	exec: CommandExecutor,
	owner: string,
	options?: { noCache?: boolean; cacheStore?: CacheStore },
): Promise<ResolvedIdentity | null> {
	const cacheStore = options?.cacheStore;
	let identityMap: Map<string, string> | null = null;

	if (!options?.noCache && cacheStore) {
		const cached = await cacheStore.read();
		identityMap = parseCachedMap(cached);
	}

	if (!identityMap) {
		identityMap = await buildIdentityMap(exec);
		if (cacheStore) {
			await cacheStore.write(serializeMap(identityMap));
		}
	}

	// Try direct match (owner is a user login)
	const directUser = identityMap.get(owner);
	if (directUser) {
		const token = await getTokenForUser(exec, directUser);
		if (token) {
			const resolvedVia = directUser === owner ? "direct" : "org";
			return { login: directUser, token, resolvedVia };
		}
	}

	// Fallback: use the active user
	const users = await listGhUsers(exec);
	const activeUser = users.find((u) => u.active);
	if (activeUser) {
		const token = await getTokenForUser(exec, activeUser.login);
		if (token) {
			return { login: activeUser.login, token, resolvedVia: "fallback" };
		}
	}

	return null;
}
