import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ─── Test Setup Verification ─────────────────────────────────────────────────

describe("test-setup mocks", () => {
	test("electron mock resolves", async () => {
		const electron = await import("electron");
		expect(electron.app).toBeDefined();
		expect(electron.app.getName()).toBe("signoff-test");
		expect(electron.app.getVersion()).toBe("0.0.0-test");
	});

	test("electron BrowserWindow mock works", async () => {
		const { BrowserWindow } = await import("electron");
		const win = new BrowserWindow();
		expect(win).toBeDefined();
		expect(typeof win.loadURL).toBe("function");
		expect(typeof win.show).toBe("function");
	});

	test("electronTRPC global exists", () => {
		expect(globalThis.electronTRPC).toBeDefined();
		expect(typeof globalThis.electronTRPC?.sendMessage).toBe("function");
		expect(typeof globalThis.electronTRPC?.onMessage).toBe("function");
	});

	test("document global exists", () => {
		expect(globalThis.document).toBeDefined();
		expect(typeof globalThis.document.createElement).toBe("function");
	});

	test("@signoff/local-db mock resolves", async () => {
		const localDb = await import("@signoff/local-db");
		expect(localDb).toBeDefined();
		expect(localDb.projects).toBeDefined();
	});
});

// ─── Shared Constants ────────────────────────────────────────────────────────

describe("shared/constants", () => {
	test("PLATFORM is a valid platform string", async () => {
		const { PLATFORM } = await import("../shared/constants");
		expect(typeof PLATFORM).toBe("string");
		expect(PLATFORM.length).toBeGreaterThan(0);
		expect([
			"aix",
			"darwin",
			"freebsd",
			"linux",
			"openbsd",
			"sunos",
			"win32",
		]).toContain(PLATFORM);
	});

	test("PROTOCOL_SCHEME is 'signoff'", async () => {
		const { PROTOCOL_SCHEME } = await import("../shared/constants");
		expect(PROTOCOL_SCHEME).toBe("signoff");
	});

	test("ICON_PROTOCOL is 'signoff-icon'", async () => {
		const { ICON_PROTOCOL } = await import("../shared/constants");
		expect(ICON_PROTOCOL).toBe("signoff-icon");
	});

	test("SIGNOFF_DIR_NAME is '.signoff'", async () => {
		const { SIGNOFF_DIR_NAME } = await import("../shared/constants");
		expect(SIGNOFF_DIR_NAME).toBe(".signoff");
	});

	test("DIR_NAMES has expected keys", async () => {
		const { DIR_NAMES } = await import("../shared/constants");
		expect(DIR_NAMES.PROJECT_ICONS).toBe("project-icons");
		expect(DIR_NAMES.DATA).toBe("data");
		expect(DIR_NAMES.LOGS).toBe("logs");
		expect(DIR_NAMES.TEMP).toBe("temp");
	});

	test("DEFAULT_WINDOW has reasonable dimensions", async () => {
		const { DEFAULT_WINDOW } = await import("../shared/constants");
		expect(DEFAULT_WINDOW.WIDTH).toBeGreaterThan(0);
		expect(DEFAULT_WINDOW.HEIGHT).toBeGreaterThan(0);
		expect(DEFAULT_WINDOW.MIN_WIDTH).toBeLessThanOrEqual(DEFAULT_WINDOW.WIDTH);
		expect(DEFAULT_WINDOW.MIN_HEIGHT).toBeLessThanOrEqual(
			DEFAULT_WINDOW.HEIGHT,
		);
	});
});

// ─── App Environment ─────────────────────────────────────────────────────────

describe("main/lib/app-environment", () => {
	test("SIGNOFF_HOME_DIR is defined and ends with .signoff", async () => {
		const { SIGNOFF_HOME_DIR } = await import("./lib/app-environment");
		expect(typeof SIGNOFF_HOME_DIR).toBe("string");
		expect(SIGNOFF_HOME_DIR.endsWith(".signoff")).toBe(true);
	});

	test("getAppStatePath returns a path containing app-state.json", async () => {
		const { getAppStatePath } = await import("./lib/app-environment");
		const p = getAppStatePath();
		expect(p.endsWith("app-state.json")).toBe(true);
		expect(p).toContain("data");
	});

	test("getWindowStatePath returns a path containing window-state.json", async () => {
		const { getWindowStatePath } = await import("./lib/app-environment");
		const p = getWindowStatePath();
		expect(p.endsWith("window-state.json")).toBe(true);
	});

	test("getDbDir returns a path containing data", async () => {
		const { getDbDir } = await import("./lib/app-environment");
		const p = getDbDir();
		expect(p).toContain("data");
	});

	test("ensureSignoffHomeDirExists creates directories without throwing", async () => {
		const { ensureSignoffHomeDirExists } = await import(
			"./lib/app-environment"
		);
		// Should not throw — creates dirs in user's home if they don't exist
		expect(() => ensureSignoffHomeDirExists()).not.toThrow();
	});
});

// ─── Project Icons ───────────────────────────────────────────────────────────

describe("main/lib/project-icons", () => {
	const TEST_DIR = path.join(tmpdir(), `signoff-test-icons-${Date.now()}`);

	beforeAll(async () => {
		// Override SIGNOFF_HOME_DIR for isolated testing
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterAll(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
	});

	test("getProjectIconProtocolUrl returns correct protocol URL", async () => {
		const { getProjectIconProtocolUrl } = await import("./lib/project-icons");
		const url = getProjectIconProtocolUrl("abc-123");
		expect(url).toBe("signoff-icon://icon/abc-123.png");
	});

	test("getProjectIconPath returns null for non-existent icon", async () => {
		const { getProjectIconPath } = await import("./lib/project-icons");
		const result = getProjectIconPath("non-existent-id-12345");
		expect(result).toBeNull();
	});

	test("ensureProjectIconsDir creates directory", async () => {
		const { ensureProjectIconsDir, getProjectIconsDir } = await import(
			"./lib/project-icons"
		);
		// This should not throw — the dir may already exist from user's actual home
		ensureProjectIconsDir();
		const dir = getProjectIconsDir();
		expect(typeof dir).toBe("string");
		expect(dir).toContain("project-icons");
	});

	test("saveProjectIconFromBuffer + readProjectIcon + deleteProjectIcon roundtrip", async () => {
		const {
			saveProjectIconFromBuffer,
			readProjectIcon,
			deleteProjectIcon,
			getProjectIconPath,
		} = await import("./lib/project-icons");

		const testId = `test-roundtrip-${Date.now()}`;
		const testData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

		// Ensure the icons dir exists before writing
		const { ensureProjectIconsDir } = await import("./lib/project-icons");
		ensureProjectIconsDir();

		// Save
		const savedPath = saveProjectIconFromBuffer(testId, testData);
		expect(existsSync(savedPath)).toBe(true);

		// Read
		const readBack = readProjectIcon(testId);
		expect(readBack).not.toBeNull();
		expect(readBack?.length).toBe(testData.length);

		// Verify getProjectIconPath returns the path
		const iconPath = getProjectIconPath(testId);
		expect(iconPath).not.toBeNull();

		// Delete
		deleteProjectIcon(testId);
		const afterDelete = getProjectIconPath(testId);
		expect(afterDelete).toBeNull();
	});
});
