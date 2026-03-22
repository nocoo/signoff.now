/**
 * Terminal session management types.
 *
 * 🔴 Trimmed from superset: DaemonManager, cold restore, history,
 * port scanning. Phase 5 provides the core types only.
 */

import type { TerminalSnapshot } from "main/lib/terminal-host/types";

/**
 * Result of creating or attaching to a terminal session.
 */
export interface SessionResult {
	/** Whether a new session was created (vs attaching to existing) */
	isNew: boolean;
	/** Serialized scrollback HTML (empty string in daemon mode) */
	scrollback: string;
	/** Whether the session was recovered from a previous connection */
	wasRecovered: boolean;
	/** Whether this was a cold restore from disk */
	isColdRestore: boolean;
	/** Previous CWD for cold-restored sessions */
	previousCwd: string | null;
	/** Terminal snapshot (daemon mode: ANSI + modes + cwd) */
	snapshot: TerminalSnapshot | null;
}

/**
 * Parameters for creating a terminal session.
 */
export interface CreateSessionParams {
	paneId: string;
	tabId: string;
	workspaceId: string;
	workspaceName?: string;
	workspacePath?: string;
	rootPath?: string;
	cwd?: string;
	cols?: number;
	rows?: number;
	command?: string;
	skipColdRestore?: boolean;
	allowKilled?: boolean;
	themeType?: "dark" | "light";
}
