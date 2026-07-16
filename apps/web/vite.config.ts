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

// https://vitejs.dev/config/
export default defineConfig(() => ({
	define: {
		__APP_VERSION__: JSON.stringify(getVersion()),
	},
	server: {
		host: "::",
		port: 7010,
		hmr: {
			overlay: false,
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
