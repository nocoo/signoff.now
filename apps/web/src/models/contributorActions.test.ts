import type { DirectoryData } from "@signoff/domain/insights";
import { beforeEach, expect, it, vi } from "vitest";
import { setContributorFollowed } from "./contributorActions";
import { saveDirectoryEntity, setDirectoryArchived } from "./directoryApi";

vi.mock("./directoryApi", () => ({
	saveDirectoryEntity: vi.fn(),
	setDirectoryArchived: vi.fn(),
}));
const data: DirectoryData = {
	source: "cli",
	revision: 42,
	blockedContributorKeys: [],
	projects: [],
	repositories: [],
	teams: [],
	tags: [],
	members: [
		{
			id: "a",
			name: "Ada",
			archivedAt: null,
			avatarUrl: null,
			identityKeys: [],
			teamIds: [],
			tagIds: [],
		},
	],
	identities: [
		{
			key: '["ado","org","bot"]',
			name: "Bot",
			provider: "ado",
			organization: "org",
			actorId: "bot",
			handle: null,
			avatarUrl: null,
			lastSeenAt: null,
			memberId: null,
		},
	],
};
beforeEach(() => vi.clearAllMocks());
it("unfollows by archiving a member and restores without dropping linked accounts", async () => {
	await setContributorFollowed("cli", "member:a", data, false);
	expect(setDirectoryArchived).toHaveBeenCalledWith(
		"cli",
		"members",
		"a",
		true,
		42,
	);
	await setContributorFollowed("cli", "member:a", data, true);
	expect(setDirectoryArchived).toHaveBeenCalledTimes(1);
	await setContributorFollowed(
		"cli",
		"member:a",
		{ ...data, members: [{ ...data.members[0], archivedAt: 5 }] },
		true,
	);
	expect(setDirectoryArchived).toHaveBeenLastCalledWith(
		"cli",
		"members",
		"a",
		false,
		42,
	);
});
it("follows an exact account and never creates a member for an unfollow", async () => {
	const key = `identity:${data.identities[0].key}`;
	await setContributorFollowed("cli", key, data, false);
	expect(saveDirectoryEntity).not.toHaveBeenCalled();
	await setContributorFollowed("cli", key, data, true);
	expect(saveDirectoryEntity).toHaveBeenCalledWith(
		"cli",
		"members",
		null,
		expect.objectContaining({
			name: "Bot",
			identityKeys: [data.identities[0].key],
		}),
		42,
	);
});
it("refuses missing or dangling identities", async () => {
	await expect(
		setContributorFollowed("cli", "identity:missing", data, true),
	).rejects.toThrow("Author account is unavailable");
	await expect(
		setContributorFollowed("cli", "member:missing", data, true),
	).rejects.toThrow("Linked member is unavailable");
});
