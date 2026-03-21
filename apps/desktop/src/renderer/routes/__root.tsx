import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden">
			<Outlet />
		</div>
	);
}
