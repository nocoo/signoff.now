import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectTags,
	getCommitsSinceTag,
	getLatestReachableTag,
	getTagCount,
	getTagDetails,
} from "./tags.ts";

const CWD = "/repo";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

describe("getTagCount", () => {
	it("counts tags", async () => {
		const exec = mockExec({
			"git tag -l": { stdout: "v1.0.0\nv1.1.0\nv2.0.0" },
		});
		expect(await getTagCount(exec, CWD)).toBe(3);
	});

	it("returns 0 when no tags", async () => {
		const exec = mockExec({ "git tag -l": { stdout: "" } });
		expect(await getTagCount(exec, CWD)).toBe(0);
	});

	it("returns 0 on error", async () => {
		const exec = mockExec({
			"git tag -l": { stdout: "", exitCode: 128 },
		});
		expect(await getTagCount(exec, CWD)).toBe(0);
	});
});

describe("getTagDetails", () => {
	it("parses annotated tags", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{
					stdout: "v1.0.0\ttag\tabc123\t2024-06-01T12:00:00+00:00\tRelease 1.0",
				},
		});
		const tags = await getTagDetails(exec, CWD);
		expect(tags).toEqual([
			{
				name: "v1.0.0",
				type: "annotated",
				sha: "abc123",
				date: "2024-06-01T12:00:00+00:00",
				message: "Release 1.0",
			},
		]);
	});

	it("parses lightweight tags", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{
					stdout: "v0.1.0\tcommit\tdef456\t2024-05-01T10:00:00+00:00\t",
				},
		});
		const tags = await getTagDetails(exec, CWD);
		expect(tags).toEqual([
			{
				name: "v0.1.0",
				type: "lightweight",
				sha: "def456",
				date: null,
				message: null,
			},
		]);
	});

	it("parses mixed tag types", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{
					stdout: [
						"v1.0.0\ttag\tabc123\t2024-06-01T12:00:00+00:00\tRelease 1.0",
						"v0.1.0\tcommit\tdef456\t2024-05-01T10:00:00+00:00\t",
					].join("\n"),
				},
		});
		const tags = await getTagDetails(exec, CWD);
		expect(tags).toHaveLength(2);
		expect(tags[0]?.type).toBe("annotated");
		expect(tags[0]?.date).toBe("2024-06-01T12:00:00+00:00");
		expect(tags[0]?.message).toBe("Release 1.0");
		expect(tags[1]?.type).toBe("lightweight");
		expect(tags[1]?.date).toBeNull();
		expect(tags[1]?.message).toBeNull();
	});

	it("returns empty array when no tags", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{ stdout: "" },
		});
		expect(await getTagDetails(exec, CWD)).toEqual([]);
	});

	it("returns empty array on error", async () => {
		const exec = mockExec({
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{ stdout: "", exitCode: 128 },
		});
		expect(await getTagDetails(exec, CWD)).toEqual([]);
	});
});

describe("getLatestReachableTag", () => {
	it("returns latest tag", async () => {
		const exec = mockExec({
			"git describe --tags --abbrev=0": { stdout: "v1.2.0" },
		});
		expect(await getLatestReachableTag(exec, CWD, true)).toBe("v1.2.0");
	});

	it("returns null when no tags exist (exit code 128)", async () => {
		const exec = mockExec({
			"git describe --tags --abbrev=0": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getLatestReachableTag(exec, CWD, true)).toBeNull();
	});

	it("returns null in empty repo", async () => {
		const exec = mockExec({});
		expect(await getLatestReachableTag(exec, CWD, false)).toBeNull();
	});
});

describe("getCommitsSinceTag", () => {
	it("returns commit count since tag", async () => {
		const exec = mockExec({
			"git rev-list v1.2.0..HEAD --count": { stdout: "5" },
		});
		expect(await getCommitsSinceTag(exec, CWD, "v1.2.0")).toBe(5);
	});

	it("returns 0 when on tagged commit", async () => {
		const exec = mockExec({
			"git rev-list v1.0.0..HEAD --count": { stdout: "0" },
		});
		expect(await getCommitsSinceTag(exec, CWD, "v1.0.0")).toBe(0);
	});

	it("returns null when tag is null", async () => {
		const exec = mockExec({});
		expect(await getCommitsSinceTag(exec, CWD, null)).toBeNull();
	});

	it("returns null on error", async () => {
		const exec = mockExec({
			"git rev-list v1.0.0..HEAD --count": {
				stdout: "",
				exitCode: 128,
			},
		});
		expect(await getCommitsSinceTag(exec, CWD, "v1.0.0")).toBeNull();
	});
});

describe("collectTags", () => {
	it("collects full tags section with reachable tag", async () => {
		const exec = mockExec({
			"git tag -l": { stdout: "v1.0.0\nv1.1.0" },
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{
					stdout: [
						"v1.0.0\ttag\tabc123\t2024-01-01T00:00:00+00:00\tFirst release",
						"v1.1.0\tcommit\tdef456\t2024-06-01T00:00:00+00:00\t",
					].join("\n"),
				},
			"git describe --tags --abbrev=0": { stdout: "v1.1.0" },
			"git rev-list v1.1.0..HEAD --count": { stdout: "3" },
		});

		const result = await collectTags(exec, CWD, true);
		expect(result.count).toBe(2);
		expect(result.tags).toHaveLength(2);
		expect(result.tags[0]?.name).toBe("v1.0.0");
		expect(result.tags[0]?.type).toBe("annotated");
		expect(result.tags[1]?.name).toBe("v1.1.0");
		expect(result.tags[1]?.type).toBe("lightweight");
		expect(result.latestReachableTag).toBe("v1.1.0");
		expect(result.commitsSinceTag).toBe(3);
	});

	it("collects tags section with no reachable tag", async () => {
		const exec = mockExec({
			"git tag -l": { stdout: "" },
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{ stdout: "" },
			"git describe --tags --abbrev=0": {
				stdout: "",
				exitCode: 128,
			},
		});

		const result = await collectTags(exec, CWD, true);
		expect(result.count).toBe(0);
		expect(result.tags).toEqual([]);
		expect(result.latestReachableTag).toBeNull();
		expect(result.commitsSinceTag).toBeNull();
	});

	it("collects tags in empty repo (no HEAD)", async () => {
		const exec = mockExec({
			"git tag -l": { stdout: "" },
			"git for-each-ref --format=%(refname:short)%(09)%(objecttype)%(09)%(objectname)%(09)%(creatordate:iso-strict)%(09)%(contents:subject) refs/tags/":
				{ stdout: "" },
		});

		const result = await collectTags(exec, CWD, false);
		expect(result.count).toBe(0);
		expect(result.tags).toEqual([]);
		expect(result.latestReachableTag).toBeNull();
		expect(result.commitsSinceTag).toBeNull();
	});
});
