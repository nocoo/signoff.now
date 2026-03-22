/**
 * Terminal Manager — bridges Electron main process to the terminal-host daemon.
 *
 * Responsibilities:
 * - Fork the terminal-host daemon as a child process (ELECTRON_RUN_AS_NODE=1)
 * - Establish control + stream NDJSON sockets with auth
 * - Proxy session CRUD operations (create, write, resize, detach, kill, signal)
 * - Forward daemon stream events (data, exit, error) to the IPC bridge
 * - Lifecycle: prewarm → reconcile → [use] → shutdown on will-quit
 *
 * Socket protocol: NDJSON (newline-delimited JSON) over Unix domain socket.
 * Auth: token file at ~/.signoff/terminal-host.token
 */

import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";
import { SIGNOFF_HOME_DIR } from "main/lib/app-environment";
import {
	type CreateOrAttachResponse,
	type IpcEvent,
	type IpcResponse,
	type ListSessionsResponse,
	PROTOCOL_VERSION,
	type TerminalDataEvent,
	type TerminalErrorEvent,
	type TerminalExitEvent,
} from "main/lib/terminal-host/types";
import type { createTerminalIpcBridge } from "./ipc-bridge";

// ── Paths ───────────────────────────────────────────────
const SOCKET_PATH = join(SIGNOFF_HOME_DIR, "terminal-host.sock");
const TOKEN_PATH = join(SIGNOFF_HOME_DIR, "terminal-host.token");

// ── Constants ───────────────────────────────────────────
const CONNECT_TIMEOUT_MS = 5_000;
const DAEMON_READY_TIMEOUT_MS = 10_000;
const CLIENT_ID = "electron-main";

// ── Types ───────────────────────────────────────────────

type IpcBridge = ReturnType<typeof createTerminalIpcBridge>;

interface PendingRequest {
	resolve: (payload: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * TerminalManager wraps the daemon lifecycle and NDJSON RPC.
 */
export class TerminalManager {
	private daemonProcess: ChildProcess | null = null;
	private controlSocket: Socket | null = null;
	private streamSocket: Socket | null = null;
	private controlBuffer = "";
	private streamBuffer = "";
	private requestId = 0;
	private pendingRequests = new Map<string, PendingRequest>();
	private ipcBridge: IpcBridge | null = null;
	private disposed = false;
	/** Tracks whether we've ever had a successful connection. */
	private wasConnected = false;

	/**
	 * Set the IPC bridge for forwarding daemon events to the renderer.
	 */
	setIpcBridge(bridge: IpcBridge): void {
		this.ipcBridge = bridge;
	}

	// ── Daemon lifecycle ─────────────────────────────────

	/**
	 * Pre-warm: fork daemon and establish socket connections.
	 */
	async prewarm(): Promise<void> {
		if (this.disposed) return;

		// If daemon is already running (e.g., from a previous app session),
		// just connect to it. Otherwise fork a new one.
		const isLive = await this.isDaemonAlive();
		if (!isLive) {
			await this.forkDaemon();
		}

		await this.connectSockets();
	}

	/**
	 * Reconcile: list sessions and clean up orphans.
	 */
	async reconcile(): Promise<void> {
		if (!this.controlSocket) return;

		try {
			await this.send<ListSessionsResponse>("listSessions", undefined);
			// For alpha: just verify we can talk to daemon. Orphan cleanup deferred.
		} catch {
			// Non-fatal — daemon may not have any sessions
		}
	}

	/**
	 * Restart: kill all sessions, shutdown daemon, re-fork.
	 */
	async restart(): Promise<{ success: boolean }> {
		try {
			await this.send("killAll", { deleteHistory: false });
			await this.send("shutdown", { killSessions: true });
		} catch {
			// Daemon may already be dead
		}
		this.disconnectSockets();
		this.daemonProcess?.kill();
		this.daemonProcess = null;

		await this.forkDaemon();
		await this.connectSockets();

		return { success: true };
	}

	/**
	 * Dispose: shutdown daemon and clean up.
	 */
	async dispose(): Promise<void> {
		this.disposed = true;

		try {
			await this.send("shutdown", { killSessions: true });
		} catch {
			// Best effort
		}

		this.disconnectSockets();
		this.daemonProcess?.kill();
		this.daemonProcess = null;

		// Reject all pending requests
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error("TerminalManager disposed"));
		}
		this.pendingRequests.clear();
	}

	// ── Session operations (proxy to daemon) ──────────────

	async createOrAttach(params: {
		sessionId: string;
		cols: number;
		rows: number;
		workspaceId: string;
		paneId: string;
		tabId: string;
		cwd?: string;
		command?: string;
	}): Promise<CreateOrAttachResponse> {
		return this.send<CreateOrAttachResponse>("createOrAttach", params);
	}

	async write(sessionId: string, data: string): Promise<void> {
		// Use notify prefix for fire-and-forget writes (high frequency)
		const id = `notify_${this.nextId()}`;
		this.sendRaw(id, "write", { sessionId, data });
	}

	async resize(sessionId: string, cols: number, rows: number): Promise<void> {
		await this.send("resize", { sessionId, cols, rows });
	}

	async detach(sessionId: string): Promise<void> {
		await this.send("detach", { sessionId });
	}

	async kill(sessionId: string): Promise<void> {
		await this.send("kill", { sessionId });
	}

	async signal(sessionId: string, signal: string): Promise<void> {
		await this.send("signal", { sessionId, signal });
	}

	async clearScrollback(sessionId: string): Promise<void> {
		await this.send("clearScrollback", { sessionId });
	}

	async listSessions(): Promise<ListSessionsResponse> {
		return this.send<ListSessionsResponse>("listSessions", undefined);
	}

	// ── Private: daemon fork ────────────────────────────

	private async forkDaemon(): Promise<void> {
		// The daemon entry point — in production this is the bundled JS.
		// electron-vite flattens all main entries into dist/main/, so terminal-host.js
		// is a sibling of index.js (not in a subdirectory).
		const daemonScript = join(__dirname, "terminal-host.js");

		this.daemonProcess = fork(daemonScript, [], {
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: "pipe",
			detached: true,
		});

		// Don't keep the main process alive just for the daemon
		this.daemonProcess.unref();

		// Wait for daemon to be ready (socket file appears)
		await this.waitForDaemon();
	}

	private waitForDaemon(): Promise<void> {
		return new Promise((resolve, reject) => {
			const start = Date.now();
			const check = () => {
				if (existsSync(SOCKET_PATH)) {
					resolve();
					return;
				}
				if (Date.now() - start > DAEMON_READY_TIMEOUT_MS) {
					reject(new Error("Daemon did not start in time"));
					return;
				}
				setTimeout(check, 100);
			};
			check();
		});
	}

	private isDaemonAlive(): Promise<boolean> {
		return new Promise((resolve) => {
			if (!existsSync(SOCKET_PATH)) {
				resolve(false);
				return;
			}
			const testSocket = new Socket();
			const timeout = setTimeout(() => {
				testSocket.destroy();
				resolve(false);
			}, 1000);
			testSocket.on("connect", () => {
				clearTimeout(timeout);
				testSocket.destroy();
				resolve(true);
			});
			testSocket.on("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});
			testSocket.connect(SOCKET_PATH);
		});
	}

	// ── Private: socket connection ──────────────────────

	private async connectSockets(): Promise<void> {
		const token = this.readToken();

		// Connect control socket
		this.controlSocket = await this.connectSocket();
		this.setupControlSocketListeners();
		await this.authenticate(this.controlSocket, token, "control");

		// Connect stream socket
		this.streamSocket = await this.connectSocket();
		this.setupStreamSocketListeners();
		await this.authenticate(this.streamSocket, token, "stream");

		this.wasConnected = true;
	}

	private connectSocket(): Promise<Socket> {
		return new Promise((resolve, reject) => {
			const socket = new Socket();
			const timeout = setTimeout(() => {
				socket.destroy();
				reject(new Error("Socket connect timeout"));
			}, CONNECT_TIMEOUT_MS);

			socket.on("connect", () => {
				clearTimeout(timeout);
				socket.setEncoding("utf-8");
				resolve(socket);
			});
			socket.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
			socket.connect(SOCKET_PATH);
		});
	}

	private async authenticate(
		socket: Socket,
		token: string,
		role: "control" | "stream",
	): Promise<void> {
		const id = this.nextId();
		const request = {
			id,
			type: "hello",
			payload: {
				token,
				protocolVersion: PROTOCOL_VERSION,
				clientId: CLIENT_ID,
				role,
			},
		};

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Auth timeout"));
			}, CONNECT_TIMEOUT_MS);

			// Temporarily listen for the hello response
			const onData = (chunk: string) => {
				const buffer =
					role === "control" ? this.controlBuffer : this.streamBuffer;
				const combined = buffer + chunk;

				const newlineIndex = combined.indexOf("\n");
				if (newlineIndex === -1) {
					if (role === "control") this.controlBuffer = combined;
					else this.streamBuffer = combined;
					return;
				}

				const line = combined.slice(0, newlineIndex);
				const rest = combined.slice(newlineIndex + 1);
				if (role === "control") this.controlBuffer = rest;
				else this.streamBuffer = rest;

				socket.removeListener("data", onData);
				clearTimeout(timeout);

				try {
					const response = JSON.parse(line) as IpcResponse;
					if (response.ok) {
						resolve();
					} else {
						reject(new Error(`Auth failed: ${response.error.message}`));
					}
				} catch {
					reject(new Error("Invalid auth response"));
				}
			};

			socket.on("data", onData);
			socket.write(`${JSON.stringify(request)}\n`);
		});
	}

	private setupControlSocketListeners(): void {
		if (!this.controlSocket) return;

		this.controlSocket.on("data", (chunk: string) => {
			this.controlBuffer += chunk;
			this.processControlBuffer();
		});

		this.controlSocket.on("close", () => {
			this.controlSocket = null;
		});

		this.controlSocket.on("error", (err) => {
			console.error("[TerminalManager] Control socket error:", err.message);
		});
	}

	private setupStreamSocketListeners(): void {
		if (!this.streamSocket) return;

		this.streamSocket.on("data", (chunk: string) => {
			this.streamBuffer += chunk;
			this.processStreamBuffer();
		});

		this.streamSocket.on("close", () => {
			this.streamSocket = null;
		});

		this.streamSocket.on("error", (err) => {
			console.error("[TerminalManager] Stream socket error:", err.message);
		});
	}

	private processControlBuffer(): void {
		let newlineIndex = this.controlBuffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.controlBuffer.slice(0, newlineIndex);
			this.controlBuffer = this.controlBuffer.slice(newlineIndex + 1);

			if (line.trim()) {
				try {
					const response = JSON.parse(line) as IpcResponse;
					const pending = this.pendingRequests.get(response.id);
					if (pending) {
						this.pendingRequests.delete(response.id);
						clearTimeout(pending.timer);
						if (response.ok) {
							pending.resolve(response.payload);
						} else {
							pending.reject(new Error(response.error.message));
						}
					}
				} catch {
					// Ignore malformed responses
				}
			}

			newlineIndex = this.controlBuffer.indexOf("\n");
		}
	}

	private processStreamBuffer(): void {
		let newlineIndex = this.streamBuffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.streamBuffer.slice(0, newlineIndex);
			this.streamBuffer = this.streamBuffer.slice(newlineIndex + 1);

			if (line.trim()) {
				try {
					const event = JSON.parse(line) as IpcEvent;
					this.handleStreamEvent(event);
				} catch {
					// Ignore malformed events
				}
			}

			newlineIndex = this.streamBuffer.indexOf("\n");
		}
	}

	private handleStreamEvent(event: IpcEvent): void {
		if (!this.ipcBridge || event.type !== "event") return;

		const { sessionId } = event;

		switch (event.event) {
			case "data": {
				const payload = event.payload as TerminalDataEvent;
				this.ipcBridge.onData(sessionId, payload.data);
				break;
			}
			case "exit": {
				const payload = event.payload as TerminalExitEvent;
				this.ipcBridge.onExit(sessionId, payload.exitCode, payload.signal);
				break;
			}
			case "error": {
				const payload = event.payload as TerminalErrorEvent;
				this.ipcBridge.onError(sessionId, payload.error);
				break;
			}
		}
	}

	private disconnectSockets(): void {
		this.controlSocket?.destroy();
		this.controlSocket = null;
		this.streamSocket?.destroy();
		this.streamSocket = null;
		this.controlBuffer = "";
		this.streamBuffer = "";
	}

	// ── Private: NDJSON RPC ─────────────────────────────

	private send<T>(type: string, payload: unknown): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const doSend = () => {
				if (!this.controlSocket) {
					reject(new Error("Control socket not connected"));
					return;
				}

				const id = this.nextId();
				const timer = setTimeout(() => {
					this.pendingRequests.delete(id);
					reject(new Error(`Request ${type} timed out`));
				}, CONNECT_TIMEOUT_MS);

				this.pendingRequests.set(id, {
					resolve: resolve as (payload: unknown) => void,
					reject,
					timer,
				});

				this.sendRaw(id, type, payload);
			};

			// Auto-reconnect: if we had a connection that dropped, try to re-establish
			if (!this.controlSocket && this.wasConnected && !this.disposed) {
				this.prewarm()
					.then(() => doSend())
					.catch(() =>
						reject(
							new Error("Control socket not connected (reconnect failed)"),
						),
					);
			} else {
				doSend();
			}
		});
	}

	private sendRaw(id: string, type: string, payload: unknown): void {
		const message = JSON.stringify({ id, type, payload });
		this.controlSocket?.write(`${message}\n`);
	}

	private nextId(): string {
		return `req_${++this.requestId}`;
	}

	private readToken(): string {
		try {
			return readFileSync(TOKEN_PATH, "utf-8").trim();
		} catch {
			throw new Error(
				`Cannot read daemon auth token at ${TOKEN_PATH}. Is the daemon running?`,
			);
		}
	}
}

// ── Convenience exports for backward compatibility ──────

let _manager: TerminalManager | null = null;

/**
 * Get the singleton TerminalManager instance.
 */
export function getTerminalManager(): TerminalManager {
	if (!_manager) {
		_manager = new TerminalManager();
	}
	return _manager;
}

/**
 * Reconcile daemon sessions on app startup.
 * Cleans up stale sessions from previous runs.
 */
export function reconcileDaemonSessions(): void {
	getTerminalManager()
		.reconcile()
		.catch((err) => {
			console.error("[terminal] Reconcile failed:", err);
		});
}

/**
 * Pre-warm terminal runtime (fork daemon, establish connections).
 */
export function prewarmTerminalRuntime(): void {
	getTerminalManager()
		.prewarm()
		.catch((err) => {
			console.error("[terminal] Prewarm failed:", err);
		});
}

/**
 * Restart the daemon process. Kills all sessions first.
 */
export async function restartDaemon(): Promise<{ success: boolean }> {
	return getTerminalManager().restart();
}
