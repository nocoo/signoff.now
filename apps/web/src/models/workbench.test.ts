import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_PULL_FILTER,
	duration,
	matchesRepository,
	nextPullSort,
	readPullFilter,
	relativeTime,
	writePullFilter,
} from "./workbench";

const NOW = 1_800_000_000;
describe("persisted PR filters", () => {
	it("normalizes legacy draft links into the dedicated draft filter", () => {
		expect(readPullFilter(new URLSearchParams("status=draft"))).toMatchObject({
			status: "all",
			draft: "only",
		});
		expect(
			readPullFilter(new URLSearchParams("status=draft&draft=include")),
		).toMatchObject({ status: "all", draft: "include" });
	});
	it("round-trips all filters without persisting pagination or PR details", () => {
		const filter = {
			...DEFAULT_PULL_FILTER,
			organization: "github.com",
			projectId: "demo-github-nocoo",
			repository: "signoff.now",
			query: "checks",
			draft: "include" as const,
			authors: ["github:maya", "github:alex"],
			state: "all" as const,
			sort: "updated" as const,
		};
		expect(readPullFilter(writePullFilter(filter))).toEqual(filter);
		expect(writePullFilter(DEFAULT_PULL_FILTER).toString()).toBe("source=demo");
		expect(
			readPullFilter(
				new URLSearchParams(
					"draft=invalid&author=&author=ado%3Amaya&author=ado%3Amaya",
				),
			),
		).toMatchObject({ draft: "exclude", authors: ["ado:maya"] });
	});
	it("uses defaults and rejects unknown enum values from shared URLs", () => {
		expect(readPullFilter(new URLSearchParams())).toEqual(DEFAULT_PULL_FILTER);
		expect(
			readPullFilter(
				new URLSearchParams("state=invalid&status=invalid&sort=invalid"),
			),
		).toEqual(DEFAULT_PULL_FILTER);
		expect(
			readPullFilter(
				new URLSearchParams(
					"q=core&org=MSDATA&project=p&repo=r&state=all&status=unknown&sort=oldest",
				),
			),
		).toEqual({
			source: "demo",
			draft: "exclude",
			authors: [],
			watching: "all",
			query: "core",
			organization: "msdata",
			projectId: "p",
			repository: "r",
			state: "all",
			status: "unknown",
			sort: "oldest",
			sortDirection: "asc",
		});
	});
	it("toggles column sorting and round-trips its direction while migrating saved legacy sorts", () => {
		expect(nextPullSort(DEFAULT_PULL_FILTER, "readiness")).toEqual({
			sort: "readiness",
			sortDirection: "desc",
		});
		expect(nextPullSort(DEFAULT_PULL_FILTER, "updated")).toEqual({
			sort: "updated",
			sortDirection: "desc",
		});
		expect(nextPullSort(DEFAULT_PULL_FILTER, "title")).toEqual({
			sort: "title",
			sortDirection: "asc",
		});
		const filter = {
			...DEFAULT_PULL_FILTER,
			...nextPullSort(DEFAULT_PULL_FILTER, "progress"),
		};
		expect(readPullFilter(writePullFilter(filter))).toEqual(filter);
		expect(readPullFilter(new URLSearchParams("sort=attention"))).toMatchObject(
			{ sort: "readiness", sortDirection: "asc" },
		);
		expect(readPullFilter(new URLSearchParams("sort=updated"))).toMatchObject({
			sort: "updated",
			sortDirection: "desc",
		});
		expect(
			readPullFilter(new URLSearchParams("sort=title&direction=invalid")),
		).toMatchObject({ sort: "title", sortDirection: "asc" });
	});
});

describe("live collection presentation", () => {
	it("matches provider IDs and repository names case-insensitively", () => {
		expect(matchesRepository({ id: "GUID", name: "Api" }, "guid")).toBe(true);
		expect(matchesRepository({ id: "GUID", name: "Api" }, "api")).toBe(true);
		expect(matchesRepository({ id: "GUID", name: "Api" }, "other")).toBe(false);
	});
});
describe("scan and stage time labels", () => {
	it("handles missing, recent, older, and future timestamps", () => {
		expect(relativeTime(null, NOW)).toBe("Never scanned");
		for (const [age, label] of [
			[-100, "just now"],
			[59, "just now"],
			[60, "1m ago"],
			[3599, "59m ago"],
			[3600, "1h ago"],
			[86400, "1d ago"],
		] as const)
			expect(relativeTime(NOW - age, NOW)).toBe(label);
		vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
		expect(relativeTime(NOW - 120)).toBe("2m ago");
		vi.restoreAllMocks();
	});
	it("does not turn missing or queued durations into elapsed work", () => {
		expect(duration(null)).toBe("—");
		expect(duration(0)).toBe("0s");
		expect(duration(59)).toBe("59s");
		expect(duration(60)).toBe("1m 0s");
		expect(duration(125)).toBe("2m 5s");
	});
});
