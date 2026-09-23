import type { DataSource, DirectoryData } from "@signoff/domain/insights";
import { saveDirectoryEntity, setDirectoryArchived } from "./directoryApi";

export async function setContributorFollowed(
	source: DataSource,
	key: string,
	data: DirectoryData,
	followed: boolean,
): Promise<void> {
	const account = key.startsWith("identity:")
		? data.identities.find((identity) => identity.key === key.slice(9))
		: undefined;
	const memberId = key.startsWith("member:") ? key.slice(7) : account?.memberId;
	const member = data.members.find((item) => item.id === memberId);
	if (member) {
		if ((member.archivedAt === null) !== followed)
			await setDirectoryArchived(
				source,
				"members",
				member.id,
				!followed,
				data.revision,
			);
		return;
	}
	if (memberId)
		throw new Error("Linked member is unavailable. Reload and try again.");
	if (!account)
		throw new Error("Author account is unavailable. Reload and try again.");
	if (!followed) return;
	await saveDirectoryEntity(
		source,
		"members",
		null,
		{
			name: account.name,
			avatarUrl: account.avatarUrl,
			identityKeys: [account.key],
			teamIds: [],
			tagIds: [],
		},
		data.revision,
	);
}
