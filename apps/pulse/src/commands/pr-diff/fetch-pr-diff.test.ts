import { describe, expect, test } from "bun:test";
import { MockGitHubClient } from "../../api/mock-client.ts";
import { fetchPrDiff } from "./fetch-pr-diff.ts";

describe("fetchPrDiff", () => {
	const diffText = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from "./foo";
 export function main() {}`;

	const filesResponse = {
		files: [
			{
				path: "src/index.ts",
				additions: 1,
				deletions: 0,
				changeType: "MODIFIED" as const,
				patch:
					'@@ -1,3 +1,4 @@\n+import { foo } from "./foo";\n export function main() {}',
			},
		],
	};

	test("fetches diff and files and assembles report", async () => {
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			filesResponse,
			diffText,
		);

		const report = await fetchPrDiff(client, {
			owner: "acme",
			repo: "repo",
			number: 42,
			resolvedUser: "alice",
			resolvedVia: "direct",
		});

		expect(report.pullRequest.number).toBe(42);
		expect(report.repository.owner).toBe("acme");
		expect(report.repository.name).toBe("repo");
		expect(report.repository.url).toBe("https://github.com/acme/repo");
		expect(report.diff).toBe(diffText);
		expect(report.files).toHaveLength(1);
		expect(report.files[0]?.path).toBe("src/index.ts");
		expect(report.generatedAt).toBeTruthy();
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("records API calls for both diff and files", async () => {
		const client = new MockGitHubClient(
			{ pullRequests: [], totalCount: 0 },
			undefined,
			filesResponse,
			diffText,
		);

		await fetchPrDiff(client, {
			owner: "acme",
			repo: "widget",
			number: 7,
			resolvedUser: "bob",
			resolvedVia: "org",
		});

		expect(client.diffCalls).toHaveLength(1);
		expect(client.diffCalls[0]).toEqual({
			owner: "acme",
			repo: "widget",
			number: 7,
		});
		expect(client.filesCalls).toHaveLength(1);
		expect(client.filesCalls[0]).toEqual({
			owner: "acme",
			repo: "widget",
			number: 7,
		});
	});
});
