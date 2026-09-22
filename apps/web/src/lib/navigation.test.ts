import { describe, expect, test } from "vitest";
import { breadcrumbsFromPathname, NAV_GROUPS } from "./navigation";

describe("navigation", () => {
	test("nav groups cover core product routes", () => {
		const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
		expect(hrefs).toContain("/prs");
		expect(hrefs).toContain("/projects");
		expect(hrefs).toContain("/insights");
		expect(hrefs).toContain("/developers");
		expect(hrefs).toContain("/settings");
		expect(breadcrumbsFromPathname("/policy-instructions")).toEqual([
			{ label: "System" },
			{ label: "Policy instructions" },
		]);
		expect(hrefs).not.toContain("/activity");
		expect(
			NAV_GROUPS.find((group) => group.label === "Workspace")?.items.map(
				(item) => item.href,
			),
		).toEqual(["/sm", "/prs", "/collections", "/repos", "/projects"]);
		expect(breadcrumbsFromPathname("/insights")).toEqual([
			{ label: "Insights" },
			{ label: "Contributions" },
		]);
	});

	test("directory breadcrumbs use the navigation group without inventing a destination", () => {
		expect(breadcrumbsFromPathname("/developers/")).toEqual([
			{ label: "Directory" },
			{ label: "Members" },
		]);
	});

	test("breadcrumbs root", () => {
		expect(breadcrumbsFromPathname("/")).toEqual([
			{ label: "Workspace" },
			{ label: "Pull requests" },
		]);
	});

	test("breadcrumbs nested", () => {
		const items = breadcrumbsFromPathname("/settings");
		expect(items[0]).toEqual({ label: "System" });
		expect(items[1]).toEqual({ label: "Settings" });
		expect(breadcrumbsFromPathname("/sm/ado/org/project/repository")).toEqual([
			{ label: "Workspace" },
			{ label: "State machines" },
		]);
		expect(
			breadcrumbsFromPathname("/prs/ado/org/project/repository/123"),
		).toEqual([{ label: "Workspace" }, { label: "Pull requests" }]);
	});

	test("breadcrumbs unknown segment falls back to raw name", () => {
		const items = breadcrumbsFromPathname("/unknown-page");
		expect(items).toEqual([{ label: "unknown-page" }]);
	});
});
