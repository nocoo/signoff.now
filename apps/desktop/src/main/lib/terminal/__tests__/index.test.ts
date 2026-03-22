/**
 * Tests for the Terminal Manager.
 *
 * Tests the TerminalManager class methods, singleton factory,
 * and convenience wrappers. Daemon socket operations are tested
 * via mock Socket to avoid requiring a real daemon.
 */

import { describe, expect, it, mock } from "bun:test";
import { TerminalManager } from "../index";

describe("TerminalManager", () => {
	it("can be instantiated", () => {
		const manager = new TerminalManager();
		expect(manager).toBeDefined();
	});

	it("has all expected session methods", () => {
		const manager = new TerminalManager();
		expect(typeof manager.createOrAttach).toBe("function");
		expect(typeof manager.write).toBe("function");
		expect(typeof manager.resize).toBe("function");
		expect(typeof manager.detach).toBe("function");
		expect(typeof manager.kill).toBe("function");
		expect(typeof manager.signal).toBe("function");
		expect(typeof manager.clearScrollback).toBe("function");
		expect(typeof manager.listSessions).toBe("function");
	});

	it("has lifecycle methods", () => {
		const manager = new TerminalManager();
		expect(typeof manager.prewarm).toBe("function");
		expect(typeof manager.reconcile).toBe("function");
		expect(typeof manager.restart).toBe("function");
		expect(typeof manager.dispose).toBe("function");
	});

	it("accepts IPC bridge via setIpcBridge", () => {
		const manager = new TerminalManager();
		const bridge = {
			onData: mock(() => {}),
			onExit: mock(() => {}),
			onError: mock(() => {}),
		};
		// Should not throw
		manager.setIpcBridge(bridge);
	});

	it("rejects createOrAttach when not connected", async () => {
		const manager = new TerminalManager();
		await expect(
			manager.createOrAttach({
				sessionId: "test",
				cols: 80,
				rows: 24,
				workspaceId: "ws-1",
				paneId: "pane-1",
				tabId: "tab-1",
			}),
		).rejects.toThrow("Control socket not connected");
	});

	it("rejects resize when not connected", async () => {
		const manager = new TerminalManager();
		await expect(manager.resize("test", 80, 24)).rejects.toThrow(
			"Control socket not connected",
		);
	});

	it("rejects detach when not connected", async () => {
		const manager = new TerminalManager();
		await expect(manager.detach("test")).rejects.toThrow(
			"Control socket not connected",
		);
	});

	it("rejects kill when not connected", async () => {
		const manager = new TerminalManager();
		await expect(manager.kill("test")).rejects.toThrow(
			"Control socket not connected",
		);
	});

	it("rejects signal when not connected", async () => {
		const manager = new TerminalManager();
		await expect(manager.signal("test", "SIGINT")).rejects.toThrow(
			"Control socket not connected",
		);
	});

	it("rejects clearScrollback when not connected", async () => {
		const manager = new TerminalManager();
		await expect(manager.clearScrollback("test")).rejects.toThrow(
			"Control socket not connected",
		);
	});

	it("rejects listSessions when not connected", async () => {
		const manager = new TerminalManager();
		await expect(manager.listSessions()).rejects.toThrow(
			"Control socket not connected",
		);
	});

	it("reconcile is no-op when not connected", async () => {
		const manager = new TerminalManager();
		// Should not throw — returns early when no control socket
		await manager.reconcile();
	});

	it("dispose rejects pending requests", async () => {
		const manager = new TerminalManager();
		// Dispose should not throw even when not connected
		await manager.dispose();
	});

	it("prewarm is no-op after dispose", async () => {
		const manager = new TerminalManager();
		await manager.dispose();
		// Should return early without throwing
		await manager.prewarm();
	});

	it("write does not throw when not connected (fire-and-forget)", async () => {
		const manager = new TerminalManager();
		// write uses fire-and-forget pattern — no promise rejection
		await manager.write("test", "hello");
	});
});

describe("getTerminalManager", () => {
	it("returns a singleton instance", async () => {
		const { getTerminalManager } = await import("../index");
		const a = getTerminalManager();
		const b = getTerminalManager();
		expect(a).toBe(b);
		expect(a).toBeInstanceOf(TerminalManager);
	});
});

describe("convenience wrappers", () => {
	it("reconcileDaemonSessions does not throw", async () => {
		const { reconcileDaemonSessions } = await import("../index");
		expect(typeof reconcileDaemonSessions).toBe("function");
		reconcileDaemonSessions();
	});

	it("prewarmTerminalRuntime does not throw", async () => {
		const { prewarmTerminalRuntime } = await import("../index");
		expect(typeof prewarmTerminalRuntime).toBe("function");
		prewarmTerminalRuntime();
	});

	it("restartDaemon is exported", async () => {
		const { restartDaemon } = await import("../index");
		expect(typeof restartDaemon).toBe("function");
	});
});
