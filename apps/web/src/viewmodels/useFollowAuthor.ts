import type { DataSource, DirectoryData } from "@signoff/domain/insights";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setContributorFollowed } from "@/models/contributorActions";
import { fetchDirectory } from "@/models/directoryApi";

export function useFollowAuthor(
	source: DataSource,
	identityKey: string | null,
) {
	const session = useMemo(
		() => ({ source, identityKey, active: true, busy: false, ticket: 0 }),
		[source, identityKey],
	);
	const current = useRef(session);
	current.current = session;
	const initialState = () => ({
		session,
		data: null as DirectoryData | null,
		loading: identityKey !== null,
		busy: false,
		followed: false,
		error: null as string | null,
	});
	const [state, setState] = useState(initialState);
	if (state.session !== session) setState(initialState());
	const isCurrent = useCallback(
		() => current.current === session && session.active,
		[session],
	);
	const publish = useCallback(
		(patch: Partial<typeof state>) => {
			if (isCurrent()) setState((previous) => ({ ...previous, ...patch }));
		},
		[isCurrent],
	);
	const reload = useCallback(async () => {
		if (!isCurrent() || identityKey === null || session.busy) return;
		const ticket = ++session.ticket;
		publish({ loading: true, error: null });
		try {
			const data = await fetchDirectory(source);
			if (ticket === session.ticket) publish({ data, loading: false });
		} catch (error) {
			if (ticket === session.ticket)
				publish({
					loading: false,
					error:
						error instanceof Error ? error.message : "Could not load author",
				});
		}
	}, [identityKey, isCurrent, publish, session, source]);
	useEffect(() => {
		session.active = true;
		void reload();
		return () => {
			session.active = false;
			session.ticket++;
		};
	}, [reload, session]);

	const identity = state.data?.identities.find(
		(item) => item.key === identityKey,
	);
	const member = state.data?.members.find(
		(item) => item.id === identity?.memberId,
	);
	const followed = state.followed || member?.archivedAt === null;
	const follow = async () => {
		if (!isCurrent() || session.busy || identityKey === null || followed)
			return;
		session.busy = true;
		publish({ busy: true, error: null });
		try {
			const data = await fetchDirectory(source);
			if (!isCurrent()) return;
			await setContributorFollowed(
				source,
				`identity:${identityKey}`,
				data,
				true,
			);
			publish({ followed: true });
		} catch (error) {
			publish({
				error:
					error instanceof Error ? error.message : "Could not follow author",
			});
		} finally {
			session.busy = false;
			publish({ busy: false });
		}
	};
	return {
		loading: state.loading,
		busy: state.busy,
		error: state.error,
		followed,
		archived: Boolean(member && member.archivedAt !== null),
		available: identityKey !== null && Boolean(identity),
		reload,
		follow,
	};
}
