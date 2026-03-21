/**
 * Tests for the hotkeys tRPC router.
 *
 * TDD: written before implementation.
 * Uses a mock store to test hotkey CRUD operations.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHotkeysRouter } from "./index";

/** Default hotkey bindings for testing. */
const DEFAULT_BINDINGS = [
	{
		action: "newTerminal",
		keys: "Cmd+T",
		label: "New Terminal",
		category: "terminal",
	},
	{
		action: "closeTab",
		keys: "Cmd+W",
		label: "Close Tab",
		category: "tabs",
	},
	{
		action: "quickOpen",
		keys: "Cmd+P",
		label: "Quick Open",
		category: "general",
	},
	{
		action: "openSettings",
		keys: "Cmd+,",
		label: "Open Settings",
		category: "general",
	},
];

/** Create a mock hotkeys store. */
function createMockStore() {
	let bindings = [...DEFAULT_BINDINGS];

	return {
		list: mock(() => Promise.resolve([...bindings])),
		get: mock((action: string) =>
			Promise.resolve(bindings.find((b) => b.action === action) ?? null),
		),
		update: mock((action: string, keys: string) => {
			bindings = bindings.map((b) =>
				b.action === action ? { ...b, keys } : b,
			);
			return Promise.resolve(bindings.find((b) => b.action === action) ?? null);
		}),
		reset: mock((action: string) => {
			const defaultBinding = DEFAULT_BINDINGS.find((b) => b.action === action);
			if (defaultBinding) {
				bindings = bindings.map((b) =>
					b.action === action ? { ...b, keys: defaultBinding.keys } : b,
				);
			}
			return Promise.resolve(bindings.find((b) => b.action === action) ?? null);
		}),
		resetAll: mock(() => {
			bindings = [...DEFAULT_BINDINGS];
			return Promise.resolve([...bindings]);
		}),
		_reset() {
			bindings = [...DEFAULT_BINDINGS];
		},
	};
}

type MockStore = ReturnType<typeof createMockStore>;

describe("hotkeys router", () => {
	let mockStore: MockStore;
	let router: ReturnType<typeof createHotkeysRouter>;

	beforeEach(() => {
		mockStore = createMockStore();
		router = createHotkeysRouter(mockStore as unknown);
	});

	afterEach(() => {
		mock.restore();
	});

	// ── list ────────────────────────────────────────────

	describe("list", () => {
		it("returns all hotkey bindings", async () => {
			const result = await router.list();

			expect(result).toHaveLength(4);
			expect(result[0].action).toBe("newTerminal");
		});

		it("calls store.list once", async () => {
			await router.list();
			expect(mockStore.list).toHaveBeenCalledTimes(1);
		});
	});

	// ── get ─────────────────────────────────────────────

	describe("get", () => {
		it("returns binding for a specific action", async () => {
			const result = await router.get({ action: "newTerminal" });

			expect(result).not.toBeNull();
			expect(result?.keys).toBe("Cmd+T");
		});

		it("returns null for unknown action", async () => {
			const result = await router.get({ action: "unknown" });

			expect(result).toBeNull();
		});
	});

	// ── update ──────────────────────────────────────────

	describe("update", () => {
		it("updates key binding for an action", async () => {
			const result = await router.update({
				action: "newTerminal",
				keys: "Ctrl+Shift+T",
			});

			expect(result?.keys).toBe("Ctrl+Shift+T");
			expect(mockStore.update).toHaveBeenCalledTimes(1);
		});
	});

	// ── reset ───────────────────────────────────────────

	describe("reset", () => {
		it("resets a single binding to default", async () => {
			await router.update({
				action: "newTerminal",
				keys: "Ctrl+Shift+T",
			});

			const result = await router.reset({ action: "newTerminal" });

			expect(result?.keys).toBe("Cmd+T");
			expect(mockStore.reset).toHaveBeenCalledTimes(1);
		});
	});

	// ── resetAll ────────────────────────────────────────

	describe("resetAll", () => {
		it("resets all bindings to defaults", async () => {
			const result = await router.resetAll();

			expect(result).toHaveLength(4);
			expect(mockStore.resetAll).toHaveBeenCalledTimes(1);
		});
	});
});
