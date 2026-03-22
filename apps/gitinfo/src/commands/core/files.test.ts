import { describe, expect, it } from "bun:test";
import { createMockExecutor } from "../../executor/mock-executor.ts";
import { createMockFsReader } from "../../executor/mock-fs-reader.ts";
import type { MockResponse } from "../../executor/types.ts";
import {
	collectFiles,
	getBinaryFiles,
	getLargestBlobs,
	getLargestTracked,
	getMostChanged,
	getTotalLines,
	getTrackedCount,
	getTypeDistribution,
	parseTrackedFiles,
} from "./files.ts";

const CWD = "/repo";
const NUL = "\0";

function mockExec(map: Record<string, MockResponse>) {
	return createMockExecutor(new Map(Object.entries(map)));
}

/** Build NUL-delimited ls-files output from entries like "100644 abc123 0\tpath" */
function lsFilesOutput(...entries: string[]): string {
	return entries.join(NUL) + NUL;
}

describe("parseTrackedFiles", () => {
	it("parses normal tracked files", async () => {
		const exec = mockExec({
			"git ls-files -z --stage": {
				stdout: lsFilesOutput(
					"100644 abc123 0\tsrc/main.ts",
					"100644 def456 0\tREADME.md",
				),
			},
		});
		const files = await parseTrackedFiles(exec, CWD);
		expect(files).toEqual([
			{ path: "src/main.ts", mode: "100644" },
			{ path: "README.md", mode: "100644" },
		]);
	});

	it("excludes gitlink entries (mode 160000)", async () => {
		const exec = mockExec({
			"git ls-files -z --stage": {
				stdout: lsFilesOutput(
					"100644 abc123 0\tsrc/main.ts",
					"160000 sub789 0\tvendor/lib",
					"100644 def456 0\tREADME.md",
				),
			},
		});
		const files = await parseTrackedFiles(exec, CWD);
		expect(files).toHaveLength(2);
		expect(files.map((f) => f.path)).toEqual(["src/main.ts", "README.md"]);
	});

	it("deduplicates conflict stages by path", async () => {
		const exec = mockExec({
			"git ls-files -z --stage": {
				stdout: lsFilesOutput(
					"100644 aaa111 1\tconflict.ts",
					"100644 bbb222 2\tconflict.ts",
					"100644 ccc333 3\tconflict.ts",
					"100644 ddd444 0\tclean.ts",
				),
			},
		});
		const files = await parseTrackedFiles(exec, CWD);
		expect(files).toHaveLength(2);
		expect(files.map((f) => f.path)).toEqual(["conflict.ts", "clean.ts"]);
	});

	it("returns empty array on command failure", async () => {
		const exec = mockExec({
			"git ls-files -z --stage": { stdout: "", exitCode: 128 },
		});
		const files = await parseTrackedFiles(exec, CWD);
		expect(files).toEqual([]);
	});

	it("returns empty array on empty output", async () => {
		const exec = mockExec({
			"git ls-files -z --stage": { stdout: "" },
		});
		const files = await parseTrackedFiles(exec, CWD);
		expect(files).toEqual([]);
	});
});

describe("getTrackedCount", () => {
	it("returns count of tracked files", () => {
		const files = [
			{ path: "a.ts", mode: "100644" },
			{ path: "b.ts", mode: "100644" },
			{ path: "c.ts", mode: "100755" },
		];
		expect(getTrackedCount(files)).toBe(3);
	});

	it("returns 0 for empty array", () => {
		expect(getTrackedCount([])).toBe(0);
	});
});

describe("getTypeDistribution", () => {
	it("counts extensions correctly", () => {
		const files = [
			{ path: "src/main.ts", mode: "100644" },
			{ path: "src/utils.ts", mode: "100644" },
			{ path: "README.md", mode: "100644" },
			{ path: "Makefile", mode: "100644" },
			{ path: "src/style.css", mode: "100644" },
		];
		const dist = getTypeDistribution(files);
		expect(dist).toEqual({
			ts: 2,
			md: 1,
			"(no ext)": 1,
			css: 1,
		});
	});

	it("returns empty object for no files", () => {
		expect(getTypeDistribution([])).toEqual({});
	});
});

describe("getTotalLines", () => {
	it("sums line counts across files", async () => {
		const exec = mockExec({
			"wc -l -- src/main.ts": { stdout: "  100 src/main.ts\n" },
			"wc -l -- README.md": { stdout: "  25 README.md\n" },
		});
		const files = [
			{ path: "src/main.ts", mode: "100644" },
			{ path: "README.md", mode: "100644" },
		];
		const total = await getTotalLines(exec, CWD, files);
		expect(total).toBe(125);
	});

	it("skips deleted files silently", async () => {
		const exec = mockExec({
			"wc -l -- exists.ts": { stdout: "  50 exists.ts\n" },
			"wc -l -- deleted.ts": { stdout: "", exitCode: 1 },
		});
		const files = [
			{ path: "exists.ts", mode: "100644" },
			{ path: "deleted.ts", mode: "100644" },
		];
		const total = await getTotalLines(exec, CWD, files);
		expect(total).toBe(50);
	});

	it("returns 0 for no files", async () => {
		const exec = mockExec({});
		expect(await getTotalLines(exec, CWD, [])).toBe(0);
	});
});

describe("getLargestTracked", () => {
	it("returns top 10 files sorted by size descending", async () => {
		const fileSizes = new Map<string, number>();
		const files = [];
		for (let i = 0; i < 12; i++) {
			const path = `file${i}.ts`;
			const size = (i + 1) * 100;
			fileSizes.set(`/repo/${path}`, size);
			files.push({ path, mode: "100644" });
		}
		const fs = createMockFsReader({ fileSizes });
		const result = await getLargestTracked(fs, "/repo", files);
		expect(result).toHaveLength(10);
		expect(result[0]?.sizeBytes).toBe(1200);
		expect(result[9]?.sizeBytes).toBe(300);
	});

	it("skips files that throw (deleted)", async () => {
		const fileSizes = new Map<string, number>([["/repo/exists.ts", 500]]);
		const fs = createMockFsReader({ fileSizes });
		const files = [
			{ path: "exists.ts", mode: "100644" },
			{ path: "deleted.ts", mode: "100644" },
		];
		const result = await getLargestTracked(fs, "/repo", files);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ path: "exists.ts", sizeBytes: 500 });
	});

	it("returns empty array for no files", async () => {
		const fs = createMockFsReader();
		const result = await getLargestTracked(fs, "/repo", []);
		expect(result).toEqual([]);
	});
});

describe("getLargestBlobs", () => {
	it("returns top 10 blobs sorted by size descending", async () => {
		const revListOutput = [
			"aaa111 src/big.bin",
			"bbb222 src/small.ts",
			"ccc333 docs/readme.md",
			"ddd444",
		].join("\n");

		const catFileOutput = [
			"aaa111 blob 50000",
			"bbb222 blob 1000",
			"ccc333 blob 2000",
		].join("\n");

		const shasInput = "aaa111\\nbbb222\\nccc333";

		const exec = mockExec({
			"git rev-list --objects --all": { stdout: revListOutput },
			[`sh -c printf '${shasInput}\\n' | git cat-file --batch-check`]: {
				stdout: catFileOutput,
			},
		});

		const result = await getLargestBlobs(exec, CWD);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({
			sha: "aaa111",
			path: "src/big.bin",
			sizeBytes: 50000,
		});
		expect(result[1]).toEqual({
			sha: "ccc333",
			path: "docs/readme.md",
			sizeBytes: 2000,
		});
	});

	it("skips tree/commit objects without paths", async () => {
		const revListOutput = ["aaa111", "bbb222", "ccc333 src/file.ts"].join("\n");

		const catFileOutput = "ccc333 blob 500\n";

		const exec = mockExec({
			"git rev-list --objects --all": { stdout: revListOutput },
			[`sh -c printf 'ccc333\\n' | git cat-file --batch-check`]: {
				stdout: catFileOutput,
			},
		});

		const result = await getLargestBlobs(exec, CWD);
		expect(result).toHaveLength(1);
		expect(result[0]?.path).toBe("src/file.ts");
	});

	it("returns empty on command failure", async () => {
		const exec = mockExec({
			"git rev-list --objects --all": { stdout: "", exitCode: 128 },
		});
		const result = await getLargestBlobs(exec, CWD);
		expect(result).toEqual([]);
	});

	it("returns empty when no objects have paths", async () => {
		const revListOutput = "aaa111\nbbb222\n";
		const exec = mockExec({
			"git rev-list --objects --all": { stdout: revListOutput },
		});
		const result = await getLargestBlobs(exec, CWD);
		expect(result).toEqual([]);
	});

	it("filters out non-blob objects from cat-file output", async () => {
		const revListOutput = "aaa111 src/file.ts\n";
		const catFileOutput = "aaa111 tree 300\n";

		const exec = mockExec({
			"git rev-list --objects --all": { stdout: revListOutput },
			[`sh -c printf 'aaa111\\n' | git cat-file --batch-check`]: {
				stdout: catFileOutput,
			},
		});

		const result = await getLargestBlobs(exec, CWD);
		expect(result).toEqual([]);
	});
});

describe("getMostChanged", () => {
	it("returns top 20 most changed files", async () => {
		const entries = [
			"src/main.ts",
			"src/main.ts",
			"src/main.ts",
			"README.md",
			"README.md",
			"src/utils.ts",
		];
		const stdout = entries.map((e) => e + NUL).join("");

		const exec = mockExec({
			"git log -z --pretty=format: --name-only -n 1000 HEAD": {
				stdout,
			},
		});

		const result = await getMostChanged(exec, CWD, true);
		expect(result[0]).toEqual({ path: "src/main.ts", count: 3 });
		expect(result[1]).toEqual({ path: "README.md", count: 2 });
		expect(result[2]).toEqual({ path: "src/utils.ts", count: 1 });
	});

	it("returns empty when no HEAD", async () => {
		const exec = mockExec({});
		const result = await getMostChanged(exec, CWD, false);
		expect(result).toEqual([]);
	});

	it("returns empty on command failure", async () => {
		const exec = mockExec({
			"git log -z --pretty=format: --name-only -n 1000 HEAD": {
				stdout: "",
				exitCode: 128,
			},
		});
		const result = await getMostChanged(exec, CWD, true);
		expect(result).toEqual([]);
	});
});

describe("getBinaryFiles", () => {
	it("identifies binary files from numstat", async () => {
		const emptyTree = "4b825dc642cb6eb9a060e54bf899d69f7cb0cb10";

		// With -z, each NUL token is "<added>\t<deleted>\t<path>"
		// Binary: "-\t-\t<path>"
		const numstatOutput = [`-\t-\timage.png`, `10\t5\tsrc/main.ts`]
			.join(NUL)
			.concat(NUL);

		const exec = mockExec({
			"git hash-object -t tree /dev/null": {
				stdout: `${emptyTree}\n`,
			},
			[`git diff -z --numstat ${emptyTree} HEAD --`]: {
				stdout: numstatOutput,
			},
		});

		const result = await getBinaryFiles(exec, CWD, true);
		expect(result).toEqual(["image.png"]);
	});

	it("handles multiple binary files", async () => {
		const emptyTree = "4b825dc642cb6eb9a060e54bf899d69f7cb0cb10";

		const numstatOutput = [
			`-\t-\timage.png`,
			`-\t-\tvideo.mp4`,
			`100\t50\tsrc/main.ts`,
		]
			.join(NUL)
			.concat(NUL);

		const exec = mockExec({
			"git hash-object -t tree /dev/null": {
				stdout: `${emptyTree}\n`,
			},
			[`git diff -z --numstat ${emptyTree} HEAD --`]: {
				stdout: numstatOutput,
			},
		});

		const result = await getBinaryFiles(exec, CWD, true);
		expect(result).toEqual(["image.png", "video.mp4"]);
	});

	it("returns empty when no binaries exist", async () => {
		const emptyTree = "4b825dc642cb6eb9a060e54bf899d69f7cb0cb10";

		const numstatOutput = `10\t5\tsrc/main.ts${NUL}`;

		const exec = mockExec({
			"git hash-object -t tree /dev/null": {
				stdout: `${emptyTree}\n`,
			},
			[`git diff -z --numstat ${emptyTree} HEAD --`]: {
				stdout: numstatOutput,
			},
		});

		const result = await getBinaryFiles(exec, CWD, true);
		expect(result).toEqual([]);
	});

	it("returns empty when no HEAD", async () => {
		const exec = mockExec({});
		const result = await getBinaryFiles(exec, CWD, false);
		expect(result).toEqual([]);
	});

	it("returns empty on hash-object failure", async () => {
		const exec = mockExec({
			"git hash-object -t tree /dev/null": { stdout: "", exitCode: 1 },
		});
		const result = await getBinaryFiles(exec, CWD, true);
		expect(result).toEqual([]);
	});

	it("returns empty on diff failure", async () => {
		const emptyTree = "4b825dc642cb6eb9a060e54bf899d69f7cb0cb10";
		const exec = mockExec({
			"git hash-object -t tree /dev/null": {
				stdout: `${emptyTree}\n`,
			},
			[`git diff -z --numstat ${emptyTree} HEAD --`]: {
				stdout: "",
				exitCode: 1,
			},
		});
		const result = await getBinaryFiles(exec, CWD, true);
		expect(result).toEqual([]);
	});
});

describe("collectFiles", () => {
	it("collects instant and moderate fields without slow", async () => {
		const exec = mockExec({
			"git ls-files -z --stage": {
				stdout: lsFilesOutput(
					"100644 abc123 0\tsrc/main.ts",
					"100644 def456 0\tREADME.md",
				),
			},
			"wc -l -- src/main.ts": { stdout: "  100 src/main.ts\n" },
			"wc -l -- README.md": { stdout: "  25 README.md\n" },
		});
		const fileSizes = new Map<string, number>([
			["/repo/src/main.ts", 3000],
			["/repo/README.md", 500],
		]);
		const fs = createMockFsReader({ fileSizes });

		const result = await collectFiles(exec, fs, CWD, true, false);

		expect(result.trackedCount).toBe(2);
		expect(result.typeDistribution).toEqual({ ts: 1, md: 1 });
		expect(result.totalLines).toBe(125);
		expect(result.largestTracked).toEqual([
			{ path: "src/main.ts", sizeBytes: 3000 },
			{ path: "README.md", sizeBytes: 500 },
		]);
		expect(result.largestBlobs).toBeUndefined();
		expect(result.mostChanged).toBeUndefined();
		expect(result.binaryFiles).toBeUndefined();
	});

	it("includes slow fields when includeSlow is true", async () => {
		const emptyTree = "4b825dc642cb6eb9a060e54bf899d69f7cb0cb10";

		const exec = mockExec({
			"git ls-files -z --stage": {
				stdout: `100644 abc123 0\tsrc/main.ts${NUL}`,
			},
			"wc -l -- src/main.ts": { stdout: "  50 src/main.ts\n" },
			"git rev-list --objects --all": {
				stdout: "aaa111 src/main.ts\n",
			},
			[`sh -c printf 'aaa111\\n' | git cat-file --batch-check`]: {
				stdout: "aaa111 blob 3000\n",
			},
			"git log -z --pretty=format: --name-only -n 1000 HEAD": {
				stdout: `src/main.ts${NUL}src/main.ts${NUL}`,
			},
			"git hash-object -t tree /dev/null": {
				stdout: `${emptyTree}\n`,
			},
			[`git diff -z --numstat ${emptyTree} HEAD --`]: {
				stdout: `10\t5\tsrc/main.ts${NUL}`,
			},
		});
		const fileSizes = new Map<string, number>([["/repo/src/main.ts", 3000]]);
		const fs = createMockFsReader({ fileSizes });

		const result = await collectFiles(exec, fs, CWD, true, true);

		expect(result.trackedCount).toBe(1);
		expect(result.totalLines).toBe(50);
		expect(result.largestBlobs).toBeDefined();
		expect(result.largestBlobs).toHaveLength(1);
		expect(result.largestBlobs?.[0]?.path).toBe("src/main.ts");
		expect(result.mostChanged).toEqual([{ path: "src/main.ts", count: 2 }]);
		expect(result.binaryFiles).toBeDefined();
		expect(result.binaryFiles).toEqual([]);
	});
});
