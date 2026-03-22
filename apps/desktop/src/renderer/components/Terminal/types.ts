/**
 * Terminal renderer types.
 *
 * 🔴 Trimmed from superset: ColdRestoreState, debug snapshot fields,
 * skipColdRestore, allowKilled, themeType. These are deferred to Phase 6+.
 */

export interface TerminalProps {
	paneId: string;
	tabId: string;
	workspaceId: string;
	/** Initial working directory for the terminal session. */
	cwd?: string;
}

export type TerminalExitReason = "killed" | "exited" | "error";

export type TerminalStreamEvent =
	| { type: "data"; data: string }
	| {
			type: "exit";
			exitCode: number;
			signal?: number;
			reason?: TerminalExitReason;
	  }
	| { type: "disconnect"; reason: string }
	| { type: "error"; error: string; code?: string };

export type CreateOrAttachResult = {
	wasRecovered: boolean;
	isNew: boolean;
	scrollback: string;
	isColdRestore?: boolean;
	previousCwd?: string | null;
	snapshot?: {
		snapshotAnsi: string;
		rehydrateSequences: string;
		cwd: string | null;
		modes: Record<string, boolean>;
		cols: number;
		rows: number;
		scrollbackLines: number;
	} | null;
};

export interface CreateOrAttachInput {
	paneId: string;
	tabId: string;
	workspaceId: string;
	cols?: number;
	rows?: number;
	cwd?: string;
	command?: string;
}

export interface CreateOrAttachCallbacks {
	onSuccess?: (data: CreateOrAttachResult) => void;
	onError?: (error: { message?: string }) => void;
	onSettled?: () => void;
}

export type CreateOrAttachMutate = (
	input: CreateOrAttachInput,
	callbacks?: CreateOrAttachCallbacks,
) => void;

export interface TerminalWriteInput {
	paneId: string;
	data: string;
	throwOnError?: boolean;
}

export interface TerminalWriteCallbacks {
	onSuccess?: () => void;
	onError?: (error: { message?: string }) => void;
	onSettled?: () => void;
}

export type TerminalWriteMutate = (
	input: TerminalWriteInput,
	callbacks?: TerminalWriteCallbacks,
) => void;

export interface TerminalResizeInput {
	paneId: string;
	cols: number;
	rows: number;
}

export type TerminalResizeMutate = (input: TerminalResizeInput) => void;

export interface TerminalDetachInput {
	paneId: string;
}

export type TerminalDetachMutate = (input: TerminalDetachInput) => void;

export interface TerminalClearScrollbackInput {
	paneId: string;
}

export type TerminalClearScrollbackMutate = (
	input: TerminalClearScrollbackInput,
) => void;
