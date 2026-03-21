import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { runtimeDependencies } from "./runtime-dependencies";
import { copyResourcesPlugin, defineEnv } from "./vite/helpers";

const DESKTOP_VITE_PORT = 5173;

export default defineConfig({
	main: {
		resolve: {
			alias: {
				"*": path.resolve(__dirname, "src"),
			},
		},
		plugins: [tsconfigPaths(), copyResourcesPlugin()],
		build: {
			outDir: "dist/main",
			lib: {
				entry: path.resolve(__dirname, "src/main/index.ts"),
			},
			rollupOptions: {
				external: [...runtimeDependencies],
			},
		},
		define: defineEnv({
			NODE_ENV: process.env.NODE_ENV,
			SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION,
			DESKTOP_VITE_PORT: String(DESKTOP_VITE_PORT),
		}),
	},

	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "dist/preload",
			lib: {
				entry: path.resolve(__dirname, "src/preload/index.ts"),
			},
		},
	},

	renderer: {
		root: path.resolve(__dirname, "src/renderer"),
		plugins: [
			tsconfigPaths(),
			TanStackRouterVite({
				routeFilePrefix: "",
				routeFileIgnorePrefix: "-",
				routesDirectory: path.resolve(__dirname, "src/renderer/routes"),
				generatedRouteTree: path.resolve(
					__dirname,
					"src/renderer/routeTree.gen.ts",
				),
				routeToken: "layout",
				indexToken: "page",
				autoCodeSplitting: true,
			}),
			tailwindcss(),
			react(),
		],
		build: {
			outDir: "dist/renderer",
			rollupOptions: {
				input: path.resolve(__dirname, "src/renderer/index.html"),
			},
		},
		server: {
			port: DESKTOP_VITE_PORT,
		},
	},
});
