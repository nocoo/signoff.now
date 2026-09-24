import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	connectorCommands,
	loadConnectors,
	revokeConnector,
	setDataOwner,
} from "./connectorApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const lastCall = () => {
	const calls = vi.mocked(apiFetch).mock.calls;
	return calls[calls.length - 1]!;
};
beforeEach(() => vi.mocked(apiFetch).mockReset());

it("loads, revokes and assigns data owners through the API", async () => {
	vi.mocked(apiFetch).mockResolvedValue({ connectors: [], ownedProjects: [] });
	expect(await loadConnectors()).toEqual({ connectors: [], ownedProjects: [] });
	expect(lastCall()[0]).toBe("/api/connectors");
	await revokeConnector("c 1");
	expect(lastCall()).toEqual(["/api/connectors/c%201", { method: "DELETE" }]);
	await setDataOwner("p1", "email:a@x.io");
	expect(lastCall()).toEqual([
		"/api/projects/p1/data-owner",
		{ method: "PUT", body: JSON.stringify({ dataOwner: "email:a@x.io" }) },
	]);
});

it("omits --server on the default site and names other sites", () => {
	expect(connectorCommands("https://signoff.hexly.ai/connectors").login).toBe(
		"signoff connector login",
	);
	expect(connectorCommands("https://signoff.example.com").login).toBe(
		"signoff connector login --server https://signoff.example.com",
	);
	expect(connectorCommands("https://signoff.hexly.ai").install).toBe(
		"npm install -g @nocoo/signoff",
	);
});
