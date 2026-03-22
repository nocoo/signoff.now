/**
 * Terminal — React component wrapping xterm.js for PTY sessions.
 *
 * Lifecycle:
 * 1. Mount: create XTerm + FitAddon → render to DOM
 * 2. Create PTY session via tRPC terminal.createOrAttach
 * 3. User input: xterm.onData → tRPC terminal.write
 * 4. PTY output: App.ipcRenderer.on("terminal:data") → xterm.write
 * 5. Resize: debounced FitAddon.fit → tRPC terminal.resize
 * 6. Cleanup: tRPC terminal.detach + xterm.dispose + remove IPC listeners
 */

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { trpc } from "../../lib/trpc";
import { RESIZE_DEBOUNCE_MS, TERMINAL_OPTIONS } from "./config";
import {
	setupClickToMoveCursor,
	setupCopyHandler,
	setupKeyboardHandler,
	setupPasteHandler,
} from "./helpers";
import type { TerminalProps } from "./types";

// Declare the App.ipcRenderer bridge exposed by preload
declare global {
	interface Window {
		App?: {
			ipcRenderer: {
				send: (channel: string, ...args: unknown[]) => void;
				on: (
					channel: string,
					listener: (...args: unknown[]) => void,
				) => () => void;
				invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
			};
		};
	}
}

export function TerminalView({
	paneId,
	tabId,
	workspaceId,
	cwd,
}: TerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const xtermRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const sessionCreated = useRef(false);

	const writeMutation = trpc.terminal.write.useMutation();
	const resizeMutation = trpc.terminal.resize.useMutation();
	const createOrAttach = trpc.terminal.createOrAttach.useMutation();
	const detachMutation = trpc.terminal.detach.useMutation();

	// Write to PTY
	const writeToTerminal = useCallback(
		(data: string) => {
			writeMutation.mutate({ paneId, data });
		},
		[paneId, writeMutation],
	);

	// Mount xterm + create session
	useEffect(() => {
		if (!containerRef.current) return;

		const xterm = new XTerm(TERMINAL_OPTIONS);
		const fitAddon = new FitAddon();
		xterm.loadAddon(fitAddon);

		xtermRef.current = xterm;
		fitAddonRef.current = fitAddon;

		xterm.open(containerRef.current);

		// Fit after a frame so dimensions are available
		requestAnimationFrame(() => {
			fitAddon.fit();
		});

		// Setup event handlers
		const cleanupCopy = setupCopyHandler(xterm);
		const cleanupPaste = setupPasteHandler(xterm, {
			onWrite: writeToTerminal,
		});
		const cleanupKeyboard = setupKeyboardHandler(xterm, {
			onWrite: writeToTerminal,
		});
		const cleanupClick = setupClickToMoveCursor(xterm, {
			onWrite: writeToTerminal,
		});

		// Forward user input to PTY
		const dataDisposable = xterm.onData((data) => {
			writeToTerminal(data);
		});

		// Create PTY session
		if (!sessionCreated.current) {
			sessionCreated.current = true;
			const dims = fitAddon.proposeDimensions();
			createOrAttach.mutate({
				paneId,
				tabId,
				workspaceId,
				cols: dims?.cols,
				rows: dims?.rows,
				cwd,
			});
		}

		// Listen for PTY output from main process via IPC bridge
		const cleanupData = window.App?.ipcRenderer.on(
			"terminal:data",
			(...args: unknown[]) => {
				const payload = args[0] as
					| { sessionId: string; data: string }
					| undefined;
				if (payload?.sessionId === paneId) {
					xterm.write(payload.data);
				}
			},
		);

		const cleanupExit = window.App?.ipcRenderer.on(
			"terminal:exit",
			(...args: unknown[]) => {
				const payload = args[0] as
					| { sessionId: string; exitCode: number }
					| undefined;
				if (payload?.sessionId === paneId) {
					xterm.write(
						`\r\n\x1b[90m[Process exited with code ${payload.exitCode}]\x1b[0m\r\n`,
					);
				}
			},
		);

		// Resize handling
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const resizeObserver = new ResizeObserver(() => {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				fitAddon.fit();
				resizeMutation.mutate({
					paneId,
					cols: xterm.cols,
					rows: xterm.rows,
				});
			}, RESIZE_DEBOUNCE_MS);
		});

		if (containerRef.current) {
			resizeObserver.observe(containerRef.current);
		}

		return () => {
			// Cleanup
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeObserver.disconnect();
			cleanupCopy();
			cleanupPaste();
			cleanupKeyboard();
			cleanupClick();
			dataDisposable.dispose();
			cleanupData?.();
			cleanupExit?.();
			detachMutation.mutate({ paneId });
			xterm.dispose();
			xtermRef.current = null;
			fitAddonRef.current = null;
		};
		// Only run on mount/unmount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		paneId,
		tabId,
		workspaceId,
		createOrAttach.mutate,
		detachMutation.mutate,
		resizeMutation.mutate,
		writeToTerminal,
		cwd,
	]);

	return (
		<div
			ref={containerRef}
			className="h-full w-full bg-[#282c34]"
			data-testid="terminal-view"
		/>
	);
}
