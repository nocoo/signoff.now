import { describe, expect, test } from "bun:test";
import { CollectError, collectAll } from "./collect";

describe("collectAll", () => {
	test("throws CollectError for non-git directory", async () => {
		await expect(collectAll("/tmp")).rejects.toBeInstanceOf(CollectError);
	});

	test("throws CollectError with descriptive message for non-git directory", async () => {
		try {
			await collectAll("/tmp");
			throw new Error("Expected to throw");
		} catch (err) {
			expect(err).toBeInstanceOf(CollectError);
			expect((err as CollectError).message).toContain("Not a git repository");
		}
	});

	test("returns a valid report for the current repo", async () => {
		// Use the signoff.now monorepo root (definitely a git repo)
		const repoRoot = `${import.meta.dir}/../../../..`;
		const report = await collectAll(repoRoot);

		// Structure checks
		expect(report).toHaveProperty("generatedAt");
		expect(report).toHaveProperty("tiers");
		expect(report).toHaveProperty("durationMs");
		expect(report).toHaveProperty("meta");
		expect(report).toHaveProperty("status");
		expect(report).toHaveProperty("branches");
		expect(report).toHaveProperty("logs");
		expect(report).toHaveProperty("contributors");
		expect(report).toHaveProperty("tags");
		expect(report).toHaveProperty("files");
		expect(report).toHaveProperty("config");
		expect(report).toHaveProperty("errors");

		// Tiers should always be full
		expect(report.tiers).toEqual(["instant", "moderate", "slow"]);

		// Duration should be positive
		expect(report.durationMs).toBeGreaterThan(0);

		// Meta should have real data (we're in a git repo)
		expect(report.meta.repoName).toBeTruthy();
		expect(report.meta.currentBranch).toBeTruthy();
	}, 60_000); // Allow up to 60s for slow collectors

	test("CollectError has correct name property", () => {
		const err = new CollectError("test");
		expect(err.name).toBe("CollectError");
		expect(err.message).toBe("test");
	});
});
