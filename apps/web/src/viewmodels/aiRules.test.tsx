import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAiRulesViewModel } from "./useAiRulesViewModel";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it("keeps common and project edits separate, saves CAS revisions and retains failed drafts", async () => {
	const data = {
		common: { revision: 0, text: "Common" },
		projects: [
			{ id: "a", name: "Alpha", revision: 2, text: "Project A" },
			{ id: "b", name: "Beta", revision: 1, text: "Project B" },
		],
	};
	const writes: unknown[] = [];
	let fail = false;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url, init) => {
			if (init?.method === "PUT") {
				const body = JSON.parse(init.body);
				writes.push(body);
				if (fail)
					return Response.json(
						{ error: "Rules changed. Reload before saving." },
						{ status: 409 },
					);
				const target =
					body.scope === "common"
						? data.common
						: data.projects.find((p) => p.id === body.scope)!;
				target.text = body.text;
				target.revision++;
				return Response.json({ saved: true });
			}
			return Response.json(data);
		}),
	);
	const { result } = renderHook(useAiRulesViewModel);
	await waitFor(() => expect(result.current.text).toBe("Common"));
	act(() => result.current.edit("Build failure means Attention"));
	await act(() => result.current.save());
	expect(writes[0]).toEqual({
		scope: "common",
		revision: 0,
		text: "Build failure means Attention",
	});
	act(() => result.current.select("a"));
	expect(result.current.text).toBe("Project A");
	act(() => result.current.edit("PoP last"));
	await act(() => result.current.save());
	expect(data.projects[1]!.text).toBe("Project B");
	fail = true;
	act(() => result.current.edit("Keep this draft"));
	await act(() => result.current.save());
	expect(result.current.text).toBe("Keep this draft");
	expect(result.current.message).toContain("Reload");
	act(() => result.current.select("common"));
	expect(result.current.text).toBe("Build failure means Attention");
});
