/**
 * In-memory cache for GitInfo reports.
 *
 * Keyed by projectId. No TTL — manual refresh only via sidebar button.
 * Cleared on app quit (Map lives in main process memory).
 */

import type { GitInfoReport } from "@signoff/gitinfo";

const cache = new Map<string, { report: GitInfoReport; fetchedAt: number }>();

export function getCached(projectId: string): GitInfoReport | null {
	return cache.get(projectId)?.report ?? null;
}

export function setCached(projectId: string, report: GitInfoReport): void {
	cache.set(projectId, { report, fetchedAt: Date.now() });
}

export function invalidate(projectId: string): void {
	cache.delete(projectId);
}

/** Visible for testing */
export function clearAll(): void {
	cache.clear();
}
