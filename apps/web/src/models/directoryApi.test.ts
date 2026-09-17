import type { DirectoryData } from "@signoff/domain/insights";
import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
	fetchDirectory,
	saveDirectoryEntity,
	setDirectoryArchived,
} from "./directoryApi";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

beforeEach(() => {
	vi.mocked(apiFetch).mockReset();
});

it("reads only the requested source and rejects a crossed source response", async () => {
	const data = {
		source: "demo",
		revision: 42,
		members: [],
	} as unknown as DirectoryData;
	vi.mocked(apiFetch).mockResolvedValue(data);
	expect(await fetchDirectory("demo")).toBe(data);
	expect(apiFetch).toHaveBeenCalledWith("/api/directory?source=demo");
	await expect(fetchDirectory("cli")).rejects.toThrow(
		"Directory source mismatch",
	);
	vi.mocked(apiFetch).mockResolvedValue(null);
	await expect(fetchDirectory("cli")).rejects.toThrow(
		"Directory source mismatch",
	);
});

it("creates and updates complete typed drafts using source-qualified endpoints", async () => {
	vi.mocked(apiFetch).mockResolvedValue({ id: "saved" });
	const draft = {
		name: "Ada",
		avatarUrl: null,
		identityKeys: [],
		teamIds: ["core"],
		tagIds: [],
	};
	expect(await saveDirectoryEntity("cli", "members", null, draft, 42)).toEqual({
		id: "saved",
	});
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/directory/members?source=cli",
		{
			method: "POST",
			headers: { "If-Match": '"42"' },
			body: JSON.stringify(draft),
		},
	);
	const team = {
		name: "Core",
		avatarUrl: null,
		memberIds: ["ada"],
		tagIds: [],
	};
	await saveDirectoryEntity("demo", "teams", "a/b ?", team, 0);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/directory/teams/a%2Fb%20%3F?source=demo",
		{
			method: "PUT",
			headers: { "If-Match": '"0"' },
			body: JSON.stringify(team),
		},
	);
	const tag = { name: "Web", color: "#336699" };
	await saveDirectoryEntity("cli", "tags", "web", tag, 43);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/directory/tags/web?source=cli",
		{
			method: "PUT",
			headers: { "If-Match": '"43"' },
			body: JSON.stringify(tag),
		},
	);
});

it("archives and restores the selected entity without losing source or path escaping", async () => {
	await setDirectoryArchived("demo", "members", "a/b", true, 42);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/directory/members/a%2Fb/archive?source=demo",
		{ method: "POST", headers: { "If-Match": '"42"' } },
	);
	await setDirectoryArchived("cli", "teams", "core", false, 43);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/directory/teams/core/restore?source=cli",
		{ method: "POST", headers: { "If-Match": '"43"' } },
	);
	await setDirectoryArchived("demo", "tags", "web", false, 0);
	expect(apiFetch).toHaveBeenLastCalledWith(
		"/api/directory/tags/web/restore?source=demo",
		{ method: "POST", headers: { "If-Match": '"0"' } },
	);
});

it("propagates server validation failures", async () => {
	vi.mocked(apiFetch).mockRejectedValue(new Error("Account already linked"));
	await expect(
		saveDirectoryEntity(
			"cli",
			"tags",
			null,
			{ name: "Web", color: "#336699" },
			42,
		),
	).rejects.toThrow("Account already linked");
});
