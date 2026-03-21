import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TRPCProvider } from "../lib/trpc-provider";

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	return (
		<TRPCProvider>
			<div className="flex h-screen w-screen flex-col overflow-hidden">
				<Outlet />
			</div>
		</TRPCProvider>
	);
}
