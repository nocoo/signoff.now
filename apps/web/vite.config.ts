import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

function getVersion(): string {
	const pkg = JSON.parse(
		readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
	);
	return pkg.version as string;
}

// Local HTTPS: https://signoff.dev.hexly.ai → Caddy → localhost:7042
// Port allocation (nmem Hexly table): main 7042; Worker dev 37042; L2 E2E 17042.
// See docs/04-Settings设计.md §4.6 and docs/03-Web模块模板.md.
export default defineConfig(() => ({
	define: {
		__APP_VERSION__: JSON.stringify(getVersion()),
	},
	server: {
		host: "::",
		port: 7042,
		allowedHosts: ["signoff.dev.hexly.ai"],
		hmr: {
			overlay: false,
		},
		// Same-origin /api/* in the browser; Caddy only terminates TLS for the SPA.
		// Worker (wrangler) listens on 37042 when local API is up.
		proxy: {
			"/api": {
				target: "http://127.0.0.1:37042",
				changeOrigin: true,
			},
		},
	},
	plugins: [tailwindcss(), react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
		dedupe: ["react", "react-dom", "react/jsx-runtime"],
	},
}));
