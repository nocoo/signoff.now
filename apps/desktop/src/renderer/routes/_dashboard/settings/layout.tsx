/**
 * Settings layout — wraps all settings sub-pages.
 *
 * Provides a two-column layout:
 * - Left: navigation sidebar with links to each settings section
 * - Right: active settings page via Outlet
 */

import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings")({
	component: SettingsLayout,
});

const NAV_ITEMS = [
	{ to: "/settings/appearance", label: "Appearance" },
	{ to: "/settings/terminal", label: "Terminal" },
	{ to: "/settings/keyboard", label: "Keyboard" },
	{ to: "/settings/git", label: "Git" },
	{ to: "/settings/behavior", label: "Behavior" },
	{ to: "/settings/presets", label: "Presets" },
] as const;

function SettingsLayout() {
	return (
		<div className="flex h-full">
			{/* Settings navigation */}
			<nav className="w-48 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-700">
				<h2 className="mb-4 text-lg font-semibold">Settings</h2>
				<ul className="space-y-1">
					{NAV_ITEMS.map((item) => (
						<li key={item.to}>
							<Link
								to={item.to}
								className="block rounded-md px-3 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 [&.active]:bg-neutral-200 [&.active]:font-medium dark:[&.active]:bg-neutral-700"
							>
								{item.label}
							</Link>
						</li>
					))}
				</ul>
			</nav>

			{/* Settings content */}
			<div className="flex-1 overflow-y-auto p-6">
				<Outlet />
			</div>
		</div>
	);
}
