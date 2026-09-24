import { expect, test } from "vitest";
import { visibleNavGroups } from "./navigation";

test("administrator pages are hidden from members", () => {
	const hrefs = (admin: boolean) =>
		visibleNavGroups(admin).flatMap((g) => g.items.map((i) => i.href));
	expect(hrefs(true)).toEqual(
		expect.arrayContaining(["/admin", "/ai-settings", "/settings"]),
	);
	expect(hrefs(false)).not.toEqual(expect.arrayContaining(["/admin"]));
	expect(hrefs(false)).not.toContain("/ai-settings");
	expect(hrefs(false)).not.toContain("/settings");
	expect(hrefs(false)).toContain("/prs");
	expect(visibleNavGroups(false).every((group) => group.items.length > 0)).toBe(
		true,
	);
});
