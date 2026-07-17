import { describe, expect, test } from "vitest";
import {
	breadcrumbsFromPathname,
	NAV_GROUPS,
	ROUTE_LABELS,
} from "./navigation";

describe("navigation", () => {
	test("nav groups cover core product routes", () => {
		const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
		expect(hrefs).toContain("/");
		expect(hrefs).toContain("/developers");
		expect(hrefs).toContain("/settings");
		expect(hrefs).toContain("/activity");
	});

	test("route labels", () => {
		expect(ROUTE_LABELS.developers).toBe("Developers");
		expect(ROUTE_LABELS.settings).toBe("Settings");
	});

	test("breadcrumbs root", () => {
		expect(breadcrumbsFromPathname("/")).toEqual([{ label: "Dashboard" }]);
	});

	test("breadcrumbs nested", () => {
		const items = breadcrumbsFromPathname("/settings");
		expect(items[0]).toEqual({ label: "Home", href: "/" });
		expect(items[1]).toEqual({ label: "Settings" });
	});

	test("breadcrumbs unknown segment falls back to raw name", () => {
		const items = breadcrumbsFromPathname("/unknown-page");
		expect(items[1]).toEqual({ label: "unknown-page" });
	});
});
