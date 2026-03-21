/**
 * Tests for language detection and CodeMirror language loading.
 *
 * NOTE: loadLanguage tests are excluded — CodeMirror packages depend on
 * browser globals (document, navigator) that aren't available in Bun test.
 * Language loading is verified in Electron runtime / E2E tests.
 */

import { describe, expect, it } from "bun:test";
import { detectLanguage } from "./languages";

describe("detectLanguage", () => {
	it("detects JavaScript extensions", () => {
		expect(detectLanguage("app.js")).toBe("javascript");
		expect(detectLanguage("module.mjs")).toBe("javascript");
		expect(detectLanguage("config.cjs")).toBe("javascript");
	});

	it("detects TypeScript extensions", () => {
		expect(detectLanguage("app.ts")).toBe("typescript");
		expect(detectLanguage("module.mts")).toBe("typescript");
		expect(detectLanguage("config.cts")).toBe("typescript");
	});

	it("detects JSX/TSX", () => {
		expect(detectLanguage("Component.jsx")).toBe("jsx");
		expect(detectLanguage("Component.tsx")).toBe("tsx");
	});

	it("detects Python", () => {
		expect(detectLanguage("script.py")).toBe("python");
		expect(detectLanguage("gui.pyw")).toBe("python");
	});

	it("detects JSON", () => {
		expect(detectLanguage("package.json")).toBe("json");
		expect(detectLanguage("tsconfig.jsonc")).toBe("json");
	});

	it("detects Markdown", () => {
		expect(detectLanguage("README.md")).toBe("markdown");
		expect(detectLanguage("doc.mdx")).toBe("markdown");
	});

	it("detects HTML", () => {
		expect(detectLanguage("index.html")).toBe("html");
		expect(detectLanguage("page.htm")).toBe("html");
	});

	it("detects CSS variants", () => {
		expect(detectLanguage("styles.css")).toBe("css");
		expect(detectLanguage("styles.scss")).toBe("css");
		expect(detectLanguage("styles.less")).toBe("css");
	});

	it("detects YAML", () => {
		expect(detectLanguage("config.yaml")).toBe("yaml");
		expect(detectLanguage("config.yml")).toBe("yaml");
	});

	it("detects SQL", () => {
		expect(detectLanguage("query.sql")).toBe("sql");
	});

	it("returns null for unknown extensions", () => {
		expect(detectLanguage("file.xyz")).toBeNull();
		expect(detectLanguage("file.rs")).toBeNull();
		expect(detectLanguage("file.go")).toBeNull();
	});

	it("returns null for files without extensions", () => {
		expect(detectLanguage("Makefile")).toBeNull();
		expect(detectLanguage("Dockerfile")).toBeNull();
	});

	it("is case insensitive for extensions", () => {
		expect(detectLanguage("FILE.JS")).toBe("javascript");
		expect(detectLanguage("README.MD")).toBe("markdown");
		expect(detectLanguage("data.JSON")).toBe("json");
	});

	it("handles paths with dots in directory names", () => {
		expect(detectLanguage("src/app.module.ts")).toBe("typescript");
		expect(detectLanguage("v1.2.3/config.json")).toBe("json");
	});
});
