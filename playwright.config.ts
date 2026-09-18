import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

if (!process.env.SIGNOFF_E2E_API_BASE || !process.env.SIGNOFF_E2E_MARKER)
	throw new Error("Run bun run test:e2e to provision disposable local state");
export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 60000,
	reporter: "list",
	outputDir: "test-results",
	forbidOnly: true,
	use: {
		baseURL: process.env.SIGNOFF_E2E_API_BASE,
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		launchOptions: {
			...(existsSync(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			)
				? {
						executablePath:
							"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					}
				: {}),
		},
	},
});
