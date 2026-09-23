import type {
	ContributorStatistics,
	DataSource,
} from "@signoff/domain/insights";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { setContributorFollowed } from "@/models/contributorActions";
import { fetchDirectory } from "@/models/directoryApi";
import { useQueryBlock } from "./useQueryBlock";

export const CONTRIBUTOR_CHANGED = "signoff-contributor-changed";

export function useContributorProfile(
	source: DataSource,
	key: string,
	open: boolean,
) {
	const session = useMemo(
		() => ({ source, key, active: true, pending: false }),
		[source, key],
	);
	const current = useRef(session);
	current.current = session;
	const [mutation, setMutation] = useState({
		session,
		busy: false,
		error: null as string | null,
	});
	useEffect(() => {
		session.active = true;
		return () => {
			session.active = false;
		};
	}, [session]);
	const query = useQueryBlock(
		open ? `contributor:${source}:${key}` : null,
		async (signal) => {
			const result = await apiFetch<{ statistics: ContributorStatistics }>(
				`/api/insights/contributor?${new URLSearchParams({ source, key })}`,
				{ signal },
			);
			if (result.statistics.key !== key || result.statistics.source !== source)
				throw new Error("Contributor scope mismatch");
			return result.statistics;
		},
		0,
	);
	const mutate = async (command: "block" | "follow", enabled: boolean) => {
		if (!session.active || current.current !== session || session.pending)
			return;
		session.pending = true;
		setMutation({ session, busy: true, error: null });
		try {
			const directory = await fetchDirectory(source);
			if (!session.active || current.current !== session) return;
			if (command === "follow")
				await setContributorFollowed(source, key, directory, enabled);
			else
				await apiFetch(`/api/directory/blocks?source=${source}`, {
					method: "POST",
					headers: { "If-Match": `"${directory.revision}"` },
					body: JSON.stringify({ key, blocked: enabled }),
				});
			window.dispatchEvent(
				new CustomEvent(CONTRIBUTOR_CHANGED, { detail: source }),
			);
			if (session.active && current.current === session) {
				query.update((statistics) => ({
					...statistics,
					[command === "block" ? "blocked" : "followed"]: enabled,
				}));
				await query.reload();
			}
		} catch (error) {
			if (session.active && current.current === session)
				setMutation({
					session,
					busy: true,
					error:
						error instanceof Error
							? error.message
							: "Could not update contributor",
				});
		} finally {
			session.pending = false;
			if (session.active && current.current === session)
				setMutation((previous) => ({ ...previous, busy: false }));
		}
	};
	return {
		...query,
		setBlocked: (blocked: boolean) => mutate("block", blocked),
		setFollowed: (followed: boolean) => mutate("follow", followed),
		busy: mutation.session === session && mutation.busy,
		error:
			(mutation.session === session ? mutation.error : null) ?? query.error,
	};
}
