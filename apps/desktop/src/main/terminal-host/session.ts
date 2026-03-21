/**
 * Terminal Host Session
 *
 * A session owns:
 * - A PTY subprocess (isolates blocking writes from main daemon)
 * - A set of attached clients
 *
 * 🔴 Trimmed from superset: HeadlessEmulator, shell-ready gating,
 * agent-setup/shell-wrappers, emulator write queue. These are deferred
 * to when we need cold restore and daemon snapshots.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { Socket } from "node:net";
import * as path from "node:path";
import type {
	CreateOrAttachRequest,
	IpcEvent,
	SessionMeta,
	TerminalDataEvent,
	TerminalErrorEvent,
	TerminalExitEvent,
	TerminalSnapshot,
} from "../lib/terminal-host/types";
import { DEFAULT_MODES } from "../lib/terminal-host/types";
import {
	createFrameHeader,
	PtySubprocessFrameDecoder,
	PtySubprocessIpcType,
} from "./pty-subprocess-ipc";

// =============================================================================
// Constants
// =============================================================================

/** Maximum bytes allowed in subprocess stdin queue. */
const MAX_SUBPROCESS_STDIN_QUEUE_BYTES = 2_000_000;

type SpawnProcess = (
	command: string,
	args: readonly string[],
	options: Parameters<typeof spawn>[2],
) => ChildProcess;

// =============================================================================
// Types
// =============================================================================

export interface SessionOptions {
	sessionId: string;
	workspaceId: string;
	paneId: string;
	tabId: string;
	cols: number;
	rows: number;
	cwd: string;
	env?: Record<string, string>;
	shell?: string;
	workspaceName?: string;
	workspacePath?: string;
	rootPath?: string;
	command?: string;
	scrollbackLines?: number;
	spawnProcess?: SpawnProcess;
}

export interface AttachedClient {
	socket: Socket;
	attachedAt: number;
}

// =============================================================================
// Session Class
// =============================================================================

export class Session {
	readonly sessionId: string;
	readonly workspaceId: string;
	readonly paneId: string;
	readonly tabId: string;
	readonly shell: string;
	readonly command?: string;
	readonly createdAt: Date;
	private readonly spawnProcess: SpawnProcess;

	private subprocess: ChildProcess | null = null;
	private subprocessReady = false;
	private attachedClients: Map<Socket, AttachedClient> = new Map();
	private lastAttachedAt: Date;
	private exitCode: number | null = null;
	private disposed = false;
	private terminatingAt: number | null = null;
	private subprocessDecoder: PtySubprocessFrameDecoder | null = null;
	private subprocessStdinQueue: Buffer[] = [];
	private subprocessStdinQueuedBytes = 0;
	private subprocessStdinDrainArmed = false;
	private ptyPid: number | null = null;

	private cols: number;
	private rows: number;

	// Promise that resolves when PTY is ready to accept writes
	private ptyReadyPromise: Promise<void>;
	private ptyReadyResolve: (() => void) | null = null;

	// Callbacks
	private onSessionExit?: (
		sessionId: string,
		exitCode: number,
		signal?: number,
	) => void;

	constructor(options: SessionOptions) {
		this.sessionId = options.sessionId;
		this.workspaceId = options.workspaceId;
		this.paneId = options.paneId;
		this.tabId = options.tabId;
		this.shell = options.shell || this.getDefaultShell();
		this.command = options.command;
		this.createdAt = new Date();
		this.lastAttachedAt = new Date();
		this.cols = options.cols;
		this.rows = options.rows;
		this.spawnProcess = options.spawnProcess ?? spawn;

		// Initialize PTY ready promise
		this.ptyReadyPromise = new Promise((resolve) => {
			this.ptyReadyResolve = resolve;
		});
	}

	/**
	 * Spawn the PTY process via subprocess
	 */
	spawn(options: {
		cwd: string;
		cols: number;
		rows: number;
		env?: Record<string, string>;
	}): void {
		if (this.subprocess) {
			throw new Error("PTY already spawned");
		}

		const { cwd, cols, rows, env } = options;

		// Build a safe env for the terminal
		const processEnv = env ?? (process.env as Record<string, string>);
		const safeEnv = { ...processEnv };
		safeEnv.TERM = "xterm-256color";

		// Simple shell args — login shell by default, or -c for commands
		const shellArgs = this.command ? ["-lc", this.command] : ["-l"];
		const subprocessPath = path.join(__dirname, "pty-subprocess.js");

		// Spawn subprocess with ELECTRON_RUN_AS_NODE=1
		const electronPath = process.execPath;
		this.subprocess = this.spawnProcess(electronPath, [subprocessPath], {
			stdio: ["pipe", "pipe", "inherit"],
			env: { ...safeEnv, ELECTRON_RUN_AS_NODE: "1" },
		});

		// Read framed messages from subprocess stdout
		if (this.subprocess.stdout) {
			this.subprocessDecoder = new PtySubprocessFrameDecoder();
			this.subprocess.stdout.on("data", (chunk: Buffer) => {
				try {
					const frames = this.subprocessDecoder?.push(chunk) ?? [];
					for (const frame of frames) {
						this.handleSubprocessFrame(frame.type, frame.payload);
					}
				} catch (error) {
					console.error(
						`[Session ${this.sessionId}] Failed to parse subprocess frames:`,
						error,
					);
				}
			});
		}

		// Handle subprocess exit
		this.subprocess.on("exit", (code) => {
			console.log(
				`[Session ${this.sessionId}] Subprocess exited with code ${code}`,
			);
			this.handleSubprocessExit(code ?? -1);
		});

		this.subprocess.on("error", (error) => {
			console.error(`[Session ${this.sessionId}] Subprocess error:`, error);
			this.handleSubprocessExit(-1);
		});

		// Store pending spawn config
		this.pendingSpawn = {
			shell: this.shell,
			args: shellArgs,
			cwd,
			cols,
			rows,
			env: safeEnv,
		};
	}

	private pendingSpawn: {
		shell: string;
		args: string[];
		cwd: string;
		cols: number;
		rows: number;
		env: Record<string, string>;
	} | null = null;

	/**
	 * Handle frames from the PTY subprocess
	 */
	private handleSubprocessFrame(
		type: PtySubprocessIpcType,
		payload: Buffer,
	): void {
		switch (type) {
			case PtySubprocessIpcType.Ready:
				this.subprocessReady = true;
				if (this.pendingSpawn) {
					this.sendSpawnToSubprocess(this.pendingSpawn);
					this.pendingSpawn = null;
				}
				break;

			case PtySubprocessIpcType.Spawned:
				this.ptyPid = payload.length >= 4 ? payload.readUInt32LE(0) : null;
				if (this.ptyReadyResolve) {
					this.ptyReadyResolve();
					this.ptyReadyResolve = null;
				}
				break;

			case PtySubprocessIpcType.Data: {
				if (payload.length === 0) break;
				const data = payload.toString("utf8");

				this.broadcastEvent("data", {
					type: "data",
					data,
				} satisfies TerminalDataEvent);
				break;
			}

			case PtySubprocessIpcType.Exit: {
				const exitCode = payload.length >= 4 ? payload.readInt32LE(0) : 0;
				const signal = payload.length >= 8 ? payload.readInt32LE(4) : 0;
				this.exitCode = exitCode;

				this.broadcastEvent("exit", {
					type: "exit",
					exitCode,
					signal: signal !== 0 ? signal : undefined,
				} satisfies TerminalExitEvent);

				this.onSessionExit?.(
					this.sessionId,
					exitCode,
					signal !== 0 ? signal : undefined,
				);
				break;
			}

			case PtySubprocessIpcType.Error: {
				const errorMessage =
					payload.length > 0
						? payload.toString("utf8")
						: "Unknown subprocess error";

				console.error(
					`[Session ${this.sessionId}] Subprocess error:`,
					errorMessage,
				);

				this.broadcastEvent("error", {
					type: "error",
					error: errorMessage,
					code: errorMessage.includes("Write queue full")
						? "WRITE_QUEUE_FULL"
						: "SUBPROCESS_ERROR",
				} satisfies TerminalErrorEvent);
				break;
			}
		}
	}

	/**
	 * Handle subprocess exiting
	 */
	private handleSubprocessExit(exitCode: number): void {
		if (this.exitCode === null) {
			this.exitCode = exitCode;

			this.broadcastEvent("exit", {
				type: "exit",
				exitCode,
			} satisfies TerminalExitEvent);

			this.onSessionExit?.(this.sessionId, exitCode);
		}

		if (this.ptyReadyResolve) {
			this.ptyReadyResolve();
			this.ptyReadyResolve = null;
		}

		this.resetProcessState();
	}

	/**
	 * Flush queued frames to subprocess stdin, respecting stream backpressure.
	 */
	private flushSubprocessStdinQueue(): void {
		if (!this.subprocess?.stdin || this.disposed) return;

		while (this.subprocessStdinQueue.length > 0) {
			const buf = this.subprocessStdinQueue[0];
			const canWrite = this.subprocess.stdin.write(buf);
			if (!canWrite) {
				if (!this.subprocessStdinDrainArmed) {
					this.subprocessStdinDrainArmed = true;
					this.subprocess.stdin.once("drain", () => {
						this.subprocessStdinDrainArmed = false;
						this.flushSubprocessStdinQueue();
					});
				}
				return;
			}

			this.subprocessStdinQueue.shift();
			this.subprocessStdinQueuedBytes -= buf.length;
		}
	}

	/**
	 * Send a frame to the subprocess.
	 */
	private sendFrameToSubprocess(
		type: PtySubprocessIpcType,
		payload?: Buffer,
	): boolean {
		if (!this.subprocess?.stdin || this.disposed) return false;

		const payloadBuffer = payload ?? Buffer.alloc(0);
		const frameSize = 5 + payloadBuffer.length;

		if (
			this.subprocessStdinQueuedBytes + frameSize >
			MAX_SUBPROCESS_STDIN_QUEUE_BYTES
		) {
			console.warn(
				`[Session ${this.sessionId}] stdin queue full (${this.subprocessStdinQueuedBytes} bytes), dropping frame`,
			);
			this.broadcastEvent("error", {
				type: "error",
				error: "Write queue full - input dropped",
				code: "WRITE_QUEUE_FULL",
			} satisfies TerminalErrorEvent);
			return false;
		}

		const header = createFrameHeader(type, payloadBuffer.length);

		this.subprocessStdinQueue.push(header);
		this.subprocessStdinQueuedBytes += header.length;

		if (payloadBuffer.length > 0) {
			this.subprocessStdinQueue.push(payloadBuffer);
			this.subprocessStdinQueuedBytes += payloadBuffer.length;
		}

		this.flushSubprocessStdinQueue();

		return !this.subprocessStdinDrainArmed;
	}

	private sendSpawnToSubprocess(payload: {
		shell: string;
		args: string[];
		cwd: string;
		cols: number;
		rows: number;
		env: Record<string, string>;
	}): boolean {
		return this.sendFrameToSubprocess(
			PtySubprocessIpcType.Spawn,
			Buffer.from(JSON.stringify(payload), "utf8"),
		);
	}

	private sendWriteToSubprocess(data: string): boolean {
		const MAX_CHUNK_CHARS = 8192;
		let ok = true;

		for (let offset = 0; offset < data.length; offset += MAX_CHUNK_CHARS) {
			const part = data.slice(offset, offset + MAX_CHUNK_CHARS);
			ok =
				this.sendFrameToSubprocess(
					PtySubprocessIpcType.Write,
					Buffer.from(part, "utf8"),
				) && ok;
		}

		return ok;
	}

	private sendResizeToSubprocess(cols: number, rows: number): boolean {
		const payload = Buffer.allocUnsafe(8);
		payload.writeUInt32LE(cols, 0);
		payload.writeUInt32LE(rows, 4);
		return this.sendFrameToSubprocess(PtySubprocessIpcType.Resize, payload);
	}

	private sendKillToSubprocess(signal?: string): boolean {
		const payload = signal ? Buffer.from(signal, "utf8") : undefined;
		return this.sendFrameToSubprocess(PtySubprocessIpcType.Kill, payload);
	}

	private sendSignalToSubprocess(signal: string): boolean {
		const payload = Buffer.from(signal, "utf8");
		return this.sendFrameToSubprocess(PtySubprocessIpcType.Signal, payload);
	}

	private sendDisposeToSubprocess(): boolean {
		return this.sendFrameToSubprocess(PtySubprocessIpcType.Dispose);
	}

	/**
	 * Check if session is alive (PTY running)
	 */
	get isAlive(): boolean {
		return this.subprocess !== null && this.exitCode === null;
	}

	/**
	 * Get the PTY process ID for port scanning.
	 */
	get pid(): number | null {
		return this.ptyPid;
	}

	/**
	 * Check if session is in the process of terminating.
	 */
	get isTerminating(): boolean {
		return this.terminatingAt !== null;
	}

	/**
	 * Check if session can be attached to.
	 */
	get isAttachable(): boolean {
		return this.isAlive && !this.isTerminating;
	}

	/**
	 * Wait for PTY to be ready to accept writes.
	 */
	waitForReady(): Promise<void> {
		return this.ptyReadyPromise;
	}

	/**
	 * Get number of attached clients
	 */
	get clientCount(): number {
		return this.attachedClients.size;
	}

	/**
	 * Attach a client to this session.
	 * Returns a minimal snapshot (no HeadlessEmulator in trimmed version).
	 */
	async attach(socket: Socket): Promise<TerminalSnapshot> {
		if (this.disposed) {
			throw new Error("Session disposed");
		}

		this.attachedClients.set(socket, {
			socket,
			attachedAt: Date.now(),
		});
		this.lastAttachedAt = new Date();

		// Return a minimal snapshot — no HeadlessEmulator in Phase 5 trim
		return {
			snapshotAnsi: "",
			rehydrateSequences: "",
			cwd: null,
			modes: { ...DEFAULT_MODES },
			cols: this.cols,
			rows: this.rows,
			scrollbackLines: 0,
		};
	}

	/**
	 * Detach a client from this session
	 */
	detach(socket: Socket): void {
		this.attachedClients.delete(socket);
	}

	/**
	 * Write data to the PTY's stdin.
	 */
	write(data: string): void {
		if (!this.subprocess || !this.subprocessReady) {
			throw new Error("PTY not spawned");
		}
		this.sendWriteToSubprocess(data);
	}

	/**
	 * Resize PTY
	 */
	resize(cols: number, rows: number): void {
		this.cols = cols;
		this.rows = rows;
		if (this.subprocess && this.subprocessReady) {
			this.sendResizeToSubprocess(cols, rows);
		}
	}

	/**
	 * Clear scrollback buffer (no-op without HeadlessEmulator)
	 */
	clearScrollback(): void {
		// No-op in trimmed version — HeadlessEmulator not yet integrated
	}

	/**
	 * Get session metadata
	 */
	getMeta(): SessionMeta {
		return {
			sessionId: this.sessionId,
			workspaceId: this.workspaceId,
			paneId: this.paneId,
			cwd: "",
			cols: this.cols,
			rows: this.rows,
			createdAt: this.createdAt.toISOString(),
			lastAttachedAt: this.lastAttachedAt.toISOString(),
			shell: this.shell,
		};
	}

	/**
	 * Send a signal to the PTY process without marking the session as terminating.
	 */
	sendSignal(signal: string): void {
		if (this.terminatingAt !== null || this.disposed) {
			return;
		}

		if (this.subprocess && this.subprocessReady) {
			this.sendSignalToSubprocess(signal);
		}
	}

	/**
	 * Kill the PTY process.
	 */
	kill(signal: string = "SIGTERM"): void {
		if (this.terminatingAt !== null) {
			return;
		}

		this.terminatingAt = Date.now();

		if (this.subprocess && this.subprocessReady) {
			this.sendKillToSubprocess(signal);
			return;
		}

		try {
			this.subprocess?.kill(signal as NodeJS.Signals);
		} catch {
			// Process may already be dead
		}
	}

	/** Callers that don't need to wait can fire-and-forget. */
	dispose(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		this.disposed = true;

		if (this.subprocess) {
			this.sendDisposeToSubprocess();
		}

		this.resetProcessState();
		this.attachedClients.clear();

		return Promise.resolve();
	}

	private resetProcessState(): void {
		this.subprocess = null;
		this.subprocessReady = false;
		this.subprocessDecoder = null;
		this.subprocessStdinQueue = [];
		this.subprocessStdinQueuedBytes = 0;
		this.subprocessStdinDrainArmed = false;
	}

	/**
	 * Set exit callback
	 */
	onExit(
		callback: (sessionId: string, exitCode: number, signal?: number) => void,
	): void {
		this.onSessionExit = callback;
	}

	/**
	 * Broadcast an event to all attached clients
	 */
	private broadcastEvent(
		eventType: string,
		payload: TerminalDataEvent | TerminalExitEvent | TerminalErrorEvent,
	): void {
		const event: IpcEvent = {
			type: "event",
			event: eventType,
			sessionId: this.sessionId,
			payload,
		};

		const message = `${JSON.stringify(event)}\n`;

		for (const { socket } of this.attachedClients.values()) {
			try {
				socket.write(message);
			} catch {
				this.attachedClients.delete(socket);
			}
		}
	}

	/**
	 * Get default shell for the platform
	 */
	private getDefaultShell(): string {
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe";
		}
		return process.env.SHELL || "/bin/zsh";
	}
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new session from request parameters
 */
export function createSession(request: CreateOrAttachRequest): Session {
	return new Session({
		sessionId: request.sessionId,
		workspaceId: request.workspaceId,
		paneId: request.paneId,
		tabId: request.tabId,
		cols: request.cols,
		rows: request.rows,
		cwd: request.cwd || process.env.HOME || "/",
		env: request.env,
		shell: request.shell,
		workspaceName: request.workspaceName,
		workspacePath: request.workspacePath,
		rootPath: request.rootPath,
		command: request.command,
	});
}
