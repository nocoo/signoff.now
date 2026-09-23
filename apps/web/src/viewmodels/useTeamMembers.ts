import { type DataSource, teamDraftSchema } from "@signoff/domain/insights";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { fetchDirectory, saveDirectoryEntity } from "@/models/directoryApi";

export function useTeamMembers(source: DataSource, teamId: string) {
	const session = useMemo(
		() => ({ source, teamId, active: true, busy: false }),
		[source, teamId],
	);
	const current = useRef(session);
	current.current = session;
	const initialState = () => ({
		session,
		selected: [] as string[],
		busy: false,
		error: null as string | null,
	});
	const [state, setState] = useState(initialState);
	if (state.session !== session) setState(initialState());
	const isCurrent = () => current.current === session && session.active;
	const publish = (patch: Partial<typeof state>) => {
		if (isCurrent()) setState((previous) => ({ ...previous, ...patch }));
	};
	useEffect(() => {
		session.active = true;
		return () => {
			session.active = false;
		};
	}, [session]);

	const select = (selected: string[]) => {
		if (!session.busy)
			publish({ selected: [...new Set(selected)], error: null });
	};
	const add = async () => {
		if (!isCurrent() || session.busy || state.selected.length === 0)
			return false;
		session.busy = true;
		publish({ busy: true, error: null });
		try {
			const data = await fetchDirectory(source);
			if (!isCurrent()) return false;
			const team = data.teams.find(
				(item) => item.id === teamId && item.archivedAt === null,
			);
			if (!team) throw new Error("This team is no longer available.");
			if (
				state.selected.some(
					(id) =>
						!data.members.some(
							(member) => member.id === id && member.archivedAt === null,
						) || data.blockedContributorKeys.includes(`member:${id}`),
				)
			) {
				throw new Error(
					"A selected member is no longer available. Review your selection.",
				);
			}
			if (state.selected.every((id) => team.memberIds.includes(id)))
				return true;
			const parsed = teamDraftSchema.safeParse({
				name: team.name,
				avatarUrl: team.avatarUrl,
				tagIds: team.tagIds,
				memberIds: [...new Set([...team.memberIds, ...state.selected])],
			});
			if (!parsed.success) throw new Error(parsed.error.issues[0].message);
			await saveDirectoryEntity(
				source,
				"teams",
				teamId,
				parsed.data,
				data.revision,
			);
			return isCurrent();
		} catch (error) {
			publish({
				error:
					error instanceof ApiError && error.status === 409
						? "The directory changed. Your selection is kept; retry to add members to the latest team."
						: error instanceof Error
							? error.message
							: "Could not add team members.",
			});
			return false;
		} finally {
			session.busy = false;
			publish({ busy: false });
		}
	};
	return {
		selected: state.selected,
		busy: state.busy,
		error: state.error,
		select,
		add,
	};
}
