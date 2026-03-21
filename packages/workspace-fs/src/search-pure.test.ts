import { describe, expect, test } from "bun:test";
import {
	invalidateAllSearchIndexes,
	invalidateSearchIndex,
	invalidateSearchIndexesForRoot,
} from "./search";

describe("invalidateSearchIndex", () => {
	test("does not throw for a non-existent index", () => {
		expect(() =>
			invalidateSearchIndex({
				rootPath: "/tmp/test-nonexistent",
				includeHidden: false,
			}),
		).not.toThrow();
	});

	test("is idempotent — calling twice does not throw", () => {
		const options = { rootPath: "/tmp/test-idempotent", includeHidden: true };
		invalidateSearchIndex(options);
		expect(() => invalidateSearchIndex(options)).not.toThrow();
	});
});

describe("invalidateSearchIndexesForRoot", () => {
	test("does not throw for a non-existent root", () => {
		expect(() =>
			invalidateSearchIndexesForRoot("/tmp/test-root-nonexistent"),
		).not.toThrow();
	});

	test("is idempotent — calling twice does not throw", () => {
		invalidateSearchIndexesForRoot("/tmp/test-root-idempotent");
		expect(() =>
			invalidateSearchIndexesForRoot("/tmp/test-root-idempotent"),
		).not.toThrow();
	});
});

describe("invalidateAllSearchIndexes", () => {
	test("does not throw when no indexes exist", () => {
		expect(() => invalidateAllSearchIndexes()).not.toThrow();
	});

	test("is idempotent — calling twice does not throw", () => {
		invalidateAllSearchIndexes();
		expect(() => invalidateAllSearchIndexes()).not.toThrow();
	});
});
