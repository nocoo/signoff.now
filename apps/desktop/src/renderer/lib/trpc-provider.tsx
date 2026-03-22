import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import superjson from "superjson";
import { ipcLink } from "trpc-electron/renderer";
import { trpc } from "./trpc";

/**
 * Wraps children with tRPC + React Query providers.
 *
 * Uses `ipcLink` from trpc-electron to communicate with the main process
 * over Electron IPC, with superjson as the transformer for rich data types.
 */
export function TRPCProvider({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: false,
					},
				},
			}),
	);

	const [trpcClient] = useState(() =>
		trpc.createClient({
			links: [ipcLink({ transformer: superjson })],
		}),
	);

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</trpc.Provider>
	);
}
