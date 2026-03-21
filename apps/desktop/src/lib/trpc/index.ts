import { initTRPC } from "@trpc/server";
import superjson from "superjson";

/**
 * tRPC initialization for the desktop app.
 *
 * Uses superjson as the transformer to support rich data types (Date, Map, Set, etc.)
 * across the Electron IPC boundary.
 */
const t = initTRPC.create({
	transformer: superjson,
});

/** Create a new tRPC router */
export const router = t.router;

/** Public (unauthenticated) procedure — desktop app has no auth */
export const publicProcedure = t.procedure;

/** Middleware builder */
export const middleware = t.middleware;
