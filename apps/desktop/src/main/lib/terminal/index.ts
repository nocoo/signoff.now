/**
 * Terminal module entry point.
 *
 * 🔴 Trimmed from superset: DaemonTerminalManager, cold restore,
 * history persistence, port scanning. Phase 5 provides stubs for
 * reconciliation and prewarm that are called from the boot sequence.
 */

/**
 * Reconcile daemon sessions on app startup.
 * Cleans up stale sessions from previous runs.
 *
 * TODO Phase 6+: Connect to daemon, list sessions, clean up orphans.
 */
export function reconcileDaemonSessions(): void {
	// Stub — daemon reconciliation deferred to Phase 6+
}

/**
 * Pre-warm terminal runtime (locale probe, daemon connection).
 *
 * TODO Phase 6+: Start locale probe and establish daemon connection.
 */
export function prewarmTerminalRuntime(): void {
	// Stub — pre-warming deferred to Phase 6+
}

/**
 * Restart the daemon process. Kills all sessions first.
 *
 * TODO Phase 6+: Connect to daemon, send killAll + shutdown, respawn.
 */
export async function restartDaemon(): Promise<{ success: boolean }> {
	// Stub — daemon restart deferred to Phase 6+
	return { success: true };
}
