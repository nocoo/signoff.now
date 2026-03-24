/**
 * In-memory cache for pulse PR reports.
 *
 * Keyed by projectId. No TTL — manual refresh only via scan button.
 * Cleared on app quit (Map lives in main process memory).
 */

import type { PrsReport } from "@signoff/pulse";

const cache = new Map<string, { report: PrsReport; fetchedAt: number }>();

export function getCached(projectId: string): PrsReport | null {
	return cache.get(projectId)?.report ?? null;
}

export function setCached(projectId: string, report: PrsReport): void {
	cache.set(projectId, { report, fetchedAt: Date.now() });
}

export function invalidate(projectId: string): void {
	cache.delete(projectId);
}

/** Visible for testing */
export function clearAll(): void {
	cache.clear();
}
