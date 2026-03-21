/**
 * Hotkeys router — keyboard shortcut management.
 *
 * Uses the factory pattern:
 * - createHotkeysRouter(store) returns plain async functions (testable)
 * - createHotkeysTrpcRouter(store) wraps in tRPC procedures
 *
 * The store dependency provides list, get, update, reset, resetAll operations.
 */

import { publicProcedure, router } from "lib/trpc";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────

export interface HotkeyBinding {
	action: string;
	keys: string;
	label: string;
	category: string;
}

// ── Factory ───────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: store type varies between test mock and production
type HotkeyStore = any;

export function createHotkeysRouter(store: HotkeyStore) {
	return {
		async list(): Promise<HotkeyBinding[]> {
			return store.list();
		},

		async get(input: { action: string }): Promise<HotkeyBinding | null> {
			return store.get(input.action);
		},

		async update(input: {
			action: string;
			keys: string;
		}): Promise<HotkeyBinding | null> {
			return store.update(input.action, input.keys);
		},

		async reset(input: { action: string }): Promise<HotkeyBinding | null> {
			return store.reset(input.action);
		},

		async resetAll(): Promise<HotkeyBinding[]> {
			return store.resetAll();
		},
	};
}

// ── tRPC wrapper ──────────────────────────────────────

export function createHotkeysTrpcRouter(store: HotkeyStore) {
	const impl = createHotkeysRouter(store);

	return router({
		list: publicProcedure.query(() => impl.list()),

		get: publicProcedure
			.input(z.object({ action: z.string() }))
			.query(({ input }) => impl.get(input)),

		update: publicProcedure
			.input(z.object({ action: z.string(), keys: z.string() }))
			.mutation(({ input }) => impl.update(input)),

		reset: publicProcedure
			.input(z.object({ action: z.string() }))
			.mutation(({ input }) => impl.reset(input)),

		resetAll: publicProcedure.mutation(() => impl.resetAll()),
	});
}

/** Stub router kept for backward compatibility. */
export const hotkeysRouter = router({});
