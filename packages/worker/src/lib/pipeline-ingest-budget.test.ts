import { describe, expect, test } from "bun:test";
import {
	estimateIngestStmtBudget,
	INGEST_STMT_BUDGET_MAX,
} from "./pipeline-ingest-write.js";

describe("estimateIngestStmtBudget", () => {
	test("worst-case 10 activities + 10 unmatched + 20 dev-days ≤ 80", () => {
		const n = estimateIngestStmtBudget({
			activityCount: 10,
			unmatchedCount: 10,
			unionSize: 20,
		});
		expect(n).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
		// 7 + (1+10+10+1) + (1+1+20+1+1) = 7+22+24 = 53
		expect(n).toBe(53);
	});

	test("empty chunk still under budget", () => {
		expect(
			estimateIngestStmtBudget({
				activityCount: 0,
				unmatchedCount: 0,
				unionSize: 0,
			}),
		).toBeLessThanOrEqual(INGEST_STMT_BUDGET_MAX);
	});
});
