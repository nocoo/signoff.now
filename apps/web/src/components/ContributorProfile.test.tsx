import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { fetchDirectory } from "@/models/directoryApi";
import { ContributorProfile } from "./ContributorProfile";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<object>()),
	apiFetch: vi.fn(),
}));
vi.mock("@/models/directoryApi", async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchDirectory: vi.fn(),
}));
let blocked = false;
let followed = false;
beforeEach(() => {
	blocked = false;
	followed = false;
	vi.mocked(apiFetch)
		.mockReset()
		.mockImplementation(async (url, options) => {
			if (options?.method === "POST") {
				if (String(url).includes("/blocks"))
					blocked = JSON.parse(String(options.body)).blocked;
				else followed = String(url).includes("/restore");
				return { ok: true };
			}
			return {
				statistics: {
					source: "cli",
					key: "member:ada",
					blocked,
					followed,
					from: "2026-06-26",
					to: "2026-09-23",
					totals: {
						total: 8,
						merged: 5,
						open: 2,
						closed: 1,
						draft: 0,
						repositories: 2,
						contributors: 1,
						lastCollectedAt: 10,
					},
					repositories: [],
				},
			};
		});
	vi.mocked(fetchDirectory).mockResolvedValue({
		source: "cli",
		revision: 42,
		blockedContributorKeys: [],
		members: [
			{
				id: "ada",
				name: "Ada",
				avatarUrl: null,
				identityKeys: [],
				teamIds: [],
				tagIds: [],
				archivedAt: 1,
			},
		],
		identities: [],
		teams: [],
		tags: [],
		projects: [],
		repositories: [],
	});
});
afterEach(cleanup);
it("opens by hover, keeps actions reachable, and blocks or unblocks with cached counts", async () => {
	render(
		<MemoryRouter>
			<ContributorProfile
				source="cli"
				contributorKey="member:ada"
				name="Ada"
				secondary="org · ada@example.com"
			/>
		</MemoryRouter>,
	);
	const trigger = screen.getByRole("button", { name: "View Ada's profile" });
	expect(apiFetch).not.toHaveBeenCalled();
	fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
	const popup = await screen.findByRole("dialog", {
		name: "Ada's contributor profile",
	});
	await within(popup).findByText("8");
	expect(within(popup).getByText("org · ada@example.com")).toBeTruthy();
	expect(
		within(popup)
			.getByRole("link", { name: "Contributions" })
			.getAttribute("href"),
	).toBe("/insights?source=cli&contributor=member%3Aada");
	fireEvent.pointerLeave(trigger);
	fireEvent.pointerEnter(popup, { pointerType: "mouse" });
	fireEvent.click(within(popup).getByRole("button", { name: "Hide" }));
	await within(popup).findByRole("button", { name: "Unhide" });
	await waitFor(() =>
		expect(
			within(popup)
				.getByRole("button", { name: "Unhide" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	fireEvent.click(within(popup).getByRole("button", { name: "Unhide" }));
	await within(popup).findByRole("button", { name: "Hide" });
});
it("opens by click for touch and keyboard users and displays read failures", async () => {
	vi.mocked(apiFetch).mockRejectedValue(new Error("Cache unavailable"));
	render(
		<MemoryRouter>
			<ContributorProfile source="cli" contributorKey="member:ada" name="Ada" />
		</MemoryRouter>,
	);
	fireEvent.click(screen.getByRole("button", { name: "View Ada's profile" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByText("Cache unavailable")).toBeTruthy();
});

it("follows and unfollows through the shared commands without changing block state", async () => {
	render(
		<MemoryRouter>
			<ContributorProfile source="cli" contributorKey="member:ada" name="Ada" />
		</MemoryRouter>,
	);
	fireEvent.click(screen.getByRole("button", { name: "View Ada's profile" }));
	const popup = await screen.findByRole("dialog");
	fireEvent.click(await within(popup).findByRole("button", { name: "Follow" }));
	await waitFor(() =>
		expect(
			within(popup)
				.getByRole("button", { name: "Unfollow" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	expect(apiFetch).toHaveBeenCalledWith(
		"/api/directory/members/ada/restore?source=cli",
		expect.objectContaining({
			method: "POST",
			headers: { "If-Match": '"42"' },
		}),
	);
	const data = await fetchDirectory("cli");
	vi.mocked(fetchDirectory).mockResolvedValue({
		...data,
		members: data.members.map((member) => ({ ...member, archivedAt: null })),
	});
	fireEvent.click(within(popup).getByRole("button", { name: "Unfollow" }));
	await within(popup).findByRole("button", { name: "Follow" });
	expect(apiFetch).toHaveBeenCalledWith(
		"/api/directory/members/ada/archive?source=cli",
		expect.objectContaining({ method: "POST" }),
	);
	expect(blocked).toBe(false);
});
