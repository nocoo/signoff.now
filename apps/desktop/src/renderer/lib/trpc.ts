import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "lib/trpc/routers";

/**
 * tRPC React hooks, typed to the desktop app's AppRouter.
 *
 * Usage in components:
 *   import { trpc } from "renderer/lib/trpc";
 *   const { data } = trpc.projects.list.useQuery();
 */
export const trpc = createTRPCReact<AppRouter>();
