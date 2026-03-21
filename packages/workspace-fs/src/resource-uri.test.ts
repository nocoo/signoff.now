import { describe, expect, it } from "bun:test";
import {
	parseWorkspaceFsResourceUri,
	toWorkspaceFsResourceUri,
} from "./resource-uri";

describe("workspace fs resource uri", () => {
	it("round-trips a posix absolute path", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "workspace-1",
			absolutePath: "/tmp/project/src/index.ts",
		});

		expect(resourceUri).toEqual(
			"workspace-fs://workspace-1/tmp/project/src/index.ts",
		);
		expect(parseWorkspaceFsResourceUri(resourceUri)).toEqual({
			workspaceId: "workspace-1",
			absolutePath: "/tmp/project/src/index.ts",
		});
	});

	it("normalizes windows paths without requiring node:path", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "workspace-2",
			absolutePath: "C:\\Users\\Kietho\\project\\.\\src\\..\\README.md",
		});

		expect(resourceUri).toEqual(
			"workspace-fs://workspace-2/c%3A/Users/Kietho/project/README.md",
		);
		expect(parseWorkspaceFsResourceUri(resourceUri)).toEqual({
			workspaceId: "workspace-2",
			absolutePath: "c:/Users/Kietho/project/README.md",
		});
	});

	it("handles empty absolute path", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "ws",
			absolutePath: "",
		});
		expect(resourceUri).toBe("workspace-fs://ws/");
	});

	it("handles UNC paths (// prefix)", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "ws",
			absolutePath: "//server/share/file.txt",
		});
		const parsed = parseWorkspaceFsResourceUri(resourceUri);
		expect(parsed?.absolutePath).toBe("//server/share/file.txt");
	});

	it("handles .. segments (parent directory traversal)", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "ws",
			absolutePath: "/root/a/b/../c/file.ts",
		});
		const parsed = parseWorkspaceFsResourceUri(resourceUri);
		expect(parsed?.absolutePath).toBe("/root/a/c/file.ts");
	});

	it("handles Windows drive letter with leading slash", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "ws",
			absolutePath: "/D:/projects/file.ts",
		});
		const parsed = parseWorkspaceFsResourceUri(resourceUri);
		expect(parsed?.absolutePath).toBe("d:/projects/file.ts");
	});

	it("handles bare Windows drive letter", () => {
		const resourceUri = toWorkspaceFsResourceUri({
			workspaceId: "ws",
			absolutePath: "E:/data",
		});
		const parsed = parseWorkspaceFsResourceUri(resourceUri);
		expect(parsed?.absolutePath).toBe("e:/data");
	});

	it("returns null for non-matching scheme", () => {
		expect(parseWorkspaceFsResourceUri("http://example.com")).toBeNull();
	});

	it("returns null for uri without path after workspace id", () => {
		expect(parseWorkspaceFsResourceUri("workspace-fs://ws")).toBeNull();
	});
});
