import {
	type DataSource,
	type DirectoryData,
	memberDraftSchema,
	tagDraftSchema,
	teamDraftSchema,
} from "@signoff/domain/insights";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
	createDirectoryEditor,
	DEFAULT_DIRECTORY_FILTER,
	type DirectoryDraftMap,
	type DirectoryEditor,
	type DirectoryFilter,
	type DirectoryKind,
	discoverAuthors,
	filterMembers,
	filterTags,
	filterTeams,
	readDirectoryFilters,
	writeDirectoryFilters,
} from "@/models/directory";
import {
	fetchDirectory,
	saveDirectoryEntity,
	setDirectoryArchived,
} from "@/models/directoryApi";
import { CONTRIBUTOR_CHANGED } from "./useContributorProfile";

const schemas = {
	members: memberDraftSchema,
	teams: teamDraftSchema,
	tags: tagDraftSchema,
};
interface Session {
	source: DataSource;
	kind: DirectoryKind;
	active: boolean;
	ticket: number;
	busy: boolean;
}
interface DirectoryState {
	session: Session;
	data: DirectoryData | null;
	filter: DirectoryFilter;
	refreshing: boolean;
	busy: boolean;
	error: string | null;
	formError: string | null;
	editor: DirectoryEditor | null;
}
function initialState(session: Session): DirectoryState {
	return {
		session,
		data: null,
		filter: readDirectoryFilters(session.source, session.kind),
		refreshing: true,
		busy: false,
		error: null,
		formError: null,
		editor: null,
	};
}

/** Directory reads occur on entry and after explicit actions, never on a PR polling timer. */
export function useDirectoryViewModel(source: DataSource, kind: DirectoryKind) {
	const session = useMemo(
		() => ({ source, kind, active: true, ticket: 0, busy: false }),
		[source, kind],
	);
	const currentSession = useRef(session);
	currentSession.current = session;
	const [state, setState] = useState(() => initialState(session));
	// Reset before painting a new source; tokens also distinguish cli → demo → cli.
	if (state.session !== session) setState(initialState(session));
	const isCurrent = useCallback(
		() => currentSession.current === session && session.active,
		[session],
	);
	const publish = useCallback(
		(patch: Partial<DirectoryState>) => {
			if (isCurrent())
				setState((previous) =>
					previous.session === session ? { ...previous, ...patch } : previous,
				);
		},
		[isCurrent, session],
	);

	const reload = useCallback(async () => {
		if (!isCurrent()) return false;
		const ticket = ++session.ticket;
		publish({ refreshing: true });
		try {
			const data = await fetchDirectory(source);
			if (!isCurrent() || ticket !== session.ticket) return false;
			publish({ data, refreshing: false, error: null });
			return true;
		} catch (error) {
			if (!isCurrent() || ticket !== session.ticket) return false;
			publish({
				refreshing: false,
				error:
					error instanceof Error ? error.message : "Could not load directory",
			});
			return false;
		}
	}, [isCurrent, publish, session, source]);

	useEffect(() => {
		session.active = true;
		void reload();
		const changed = (event: Event) => {
			if ((event as CustomEvent).detail === source) void reload();
		};
		window.addEventListener(CONTRIBUTOR_CHANGED, changed);
		return () => {
			window.removeEventListener(CONTRIBUTOR_CHANGED, changed);
			session.active = false;
			session.ticket++;
		};
	}, [reload, session, source]);

	const setFilter = useCallback(
		(patch: Partial<DirectoryFilter>) => {
			if (!isCurrent()) return;
			setState((previous) => {
				if (previous.session !== session) return previous;
				const filter = { ...previous.filter, ...patch };
				writeDirectoryFilters(source, kind, filter);
				return { ...previous, filter };
			});
		},
		[isCurrent, kind, session, source],
	);
	const resetFilter = useCallback(
		() => setFilter(DEFAULT_DIRECTORY_FILTER),
		[setFilter],
	);

	const edit = (id: string | null = null) => {
		if (!isCurrent() || session.busy || !state.data) return;
		publish({
			editor: createDirectoryEditor(kind, state.data, id),
			formError: null,
		});
	};
	const closeEditor = () => {
		if (!session.busy) publish({ editor: null, formError: null });
	};
	const updateDraft = (
		patch: Partial<
			DirectoryDraftMap["members"] &
				DirectoryDraftMap["teams"] &
				DirectoryDraftMap["tags"]
		>,
	) => {
		if (!session.busy && state.editor)
			publish({
				editor: {
					...state.editor,
					draft: { ...state.editor.draft, ...patch },
				} as DirectoryEditor,
				formError: null,
			});
	};
	const follow = (key: string) => {
		if (kind !== "members" || session.busy || !isCurrent() || !state.data)
			return;
		const identity = state.data.identities.find(
			(account) => account.key === key && account.memberId === null,
		);
		if (!identity) return;
		publish({
			formError: null,
			editor: {
				kind: "members",
				id: null,
				// Switching "Follow as" never rebases an open editor onto a new revision.
				revision:
					state.editor?.followKey === key
						? state.editor.revision
						: state.data.revision,
				followKey: key,
				draft: {
					name: identity.name,
					avatarUrl: identity.avatarUrl,
					identityKeys: [key],
					teamIds: [],
					tagIds: [],
				},
			},
		});
	};
	const chooseFollowMember = (id: string | null) => {
		const editor = state.editor;
		if (
			session.busy ||
			!state.data ||
			editor?.kind !== "members" ||
			!editor.followKey
		)
			return;
		if (id === null) {
			follow(editor.followKey);
			return;
		}
		const next = createDirectoryEditor("members", state.data, id);
		if (next?.kind !== "members") return;
		next.revision = editor.revision;
		next.followKey = editor.followKey;
		next.draft.identityKeys = [
			...new Set([...next.draft.identityKeys, editor.followKey]),
		];
		publish({ editor: next, formError: null });
	};

	const mutate = async (
		run: () => Promise<unknown>,
		closeOnSuccess: boolean,
	) => {
		if (session.busy || !isCurrent()) return false;
		session.busy = true;
		// Supersede both the pre-write result and its loading indicator. A later
		// reload owns its own indicator, which this mutation's finally must retain.
		++session.ticket;
		publish({ busy: true, refreshing: false, error: null, formError: null });
		try {
			await run();
			if (!isCurrent()) return false;
			// A successful create must not be submitted again if its follow-up read fails.
			if (closeOnSuccess) publish({ editor: null });
			await reload();
			return true;
		} catch (error) {
			let message =
				error instanceof Error ? error.message : "Could not save changes";
			if (error instanceof ApiError && error.status === 409) {
				message += closeOnSuccess
					? " Your draft is kept. Reload the directory and reopen the editor before retrying."
					: " Reload the directory before retrying.";
			}
			publish(closeOnSuccess ? { formError: message } : { error: message });
			return false;
		} finally {
			session.busy = false;
			publish({ busy: false });
		}
	};
	const save = async () => {
		const editor = state.editor;
		if (!editor || session.busy || !isCurrent()) return false;
		const parsed = schemas[editor.kind].safeParse(editor.draft);
		if (!parsed.success) {
			publish({ formError: parsed.error.issues[0].message });
			return false;
		}
		if (editor.kind === "members") {
			for (const key of editor.draft.identityKeys) {
				const identity = state.data?.identities.find(
					(account) => account.key === key,
				);
				if (
					!identity ||
					(identity.memberId !== null && identity.memberId !== editor.id)
				) {
					publish({
						formError: identity
							? "This account is already linked to another member."
							: "This account is no longer available. Reload the directory.",
					});
					return false;
				}
			}
		}
		return mutate(
			() =>
				saveDirectoryEntity(
					source,
					editor.kind,
					editor.id,
					parsed.data,
					editor.revision,
				),
			true,
		);
	};
	const setArchived = (id: string, archived: boolean) => {
		const data = state.data;
		if (!data?.[kind].some((row) => row.id === id))
			return Promise.resolve(false);
		return mutate(
			() => setDirectoryArchived(source, kind, id, archived, data.revision),
			false,
		);
	};

	const members = useMemo(
		() => (state.data ? filterMembers(state.data, state.filter) : []),
		[state.data, state.filter],
	);
	const teams = useMemo(
		() => (state.data ? filterTeams(state.data, state.filter) : []),
		[state.data, state.filter],
	);
	const tags = useMemo(
		() => (state.data ? filterTags(state.data, state.filter) : []),
		[state.data, state.filter],
	);
	const authors = useMemo(
		() =>
			state.data
				? discoverAuthors(
						state.data,
						state.filter.keyword,
						state.filter.view === "blocked",
					)
				: [],
		[state.data, state.filter.keyword, state.filter.view],
	);
	return {
		data: state.data,
		filter: state.filter,
		members,
		teams,
		tags,
		authors,
		loading: state.data === null && state.refreshing,
		refreshing: state.refreshing,
		busy: state.busy,
		error: state.error,
		formError: state.formError,
		editor: state.editor,
		setFilter,
		resetFilter,
		edit,
		closeEditor,
		updateDraft,
		follow,
		chooseFollowMember,
		save,
		setArchived,
		reload,
	};
}

export type DirectoryViewModel = ReturnType<typeof useDirectoryViewModel>;
