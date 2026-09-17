import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PullDescription } from "./PullDescription";

afterEach(cleanup);
const sourceUrl = "https://dev.azure.com/acme/Platform/_git/web/pullrequest/42";

describe("PR descriptions", () => {
	it("renders Markdown headings, lists, code, tables, and task checkboxes", () => {
		const { container } = render(
			<PullDescription
				sourceUrl={sourceUrl}
				description={[
					"## Summary",
					"",
					"Fix **loading** with `await` and ~~remove the old path~~.",
					"",
					"- [x] Tests pass",
					"- [ ] Human verification",
					"",
					"| Check | Result |",
					"| --- | --- |",
					"| Build | Passed |",
					"",
					"```ts",
					"await collect();",
					"```",
				].join("\n")}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Summary", level: 2 }),
		).toBeTruthy();
		expect(container.querySelector("strong")?.textContent).toBe("loading");
		expect(container.querySelector("del")?.textContent).toBe(
			"remove the old path",
		);
		expect(container.querySelector("pre code")?.textContent).toBe(
			"await collect();\n",
		);
		expect(screen.getByRole("table").textContent).toContain("BuildPassed");
		expect(screen.getByRole("checkbox", { checked: true })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.getByRole("checkbox", { checked: false })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("opens safe links at the PR source and prevents HTML or unsafe URLs from executing", () => {
		const { container } = render(
			<PullDescription
				sourceUrl={sourceUrl}
				description={[
					"[Guide](https://example.com/guide) · [Related](43) · [Unsafe](javascript:alert%281%29)",
					"",
					"![Preview](https://example.com/preview.png)",
					"![Unsafe image](javascript:alert%281%29)",
					"",
					'<script>alert("unsafe")</script>',
					'<img src="x" onerror="alert(1)">',
					'<iframe src="https://example.com"></iframe>',
				].join("\n")}
			/>,
		);
		const guide = screen.getByRole("link", { name: "Guide" });
		expect(guide.getAttribute("href")).toBe("https://example.com/guide");
		expect(guide.getAttribute("target")).toBe("_blank");
		expect(guide.getAttribute("rel")).toBe("noopener noreferrer");
		expect(
			screen.getByRole("link", { name: "Related" }).getAttribute("href"),
		).toBe("https://dev.azure.com/acme/Platform/_git/web/pullrequest/43");
		expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
		expect(screen.getAllByRole("img")).toHaveLength(1);
		expect(
			screen.getByRole("img", { name: "Preview" }).getAttribute("loading"),
		).toBe("lazy");
		expect(container.querySelector("script, iframe, [onerror]")).toBeNull();
	});

	it("keeps the empty-description fallback", () => {
		render(<PullDescription description="  " sourceUrl={sourceUrl} />);
		expect(screen.getByText("No description provided.")).toBeTruthy();
	});
});
