import type {
	ContributionFilters,
	ContributionModule,
	ContributionSnapshot,
} from "@signoff/domain/insights";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	calculateContribution,
	fetchContribution,
} from "@/models/contributionsApi";

type ModuleState = {
	key: string;
	snapshot: ContributionSnapshot | null;
	loading: boolean;
	refreshing: boolean;
	error: string | null;
};

/** Read saved calculations on navigation; POST only in response to refresh(). */
export function useContributionModule(
	module: ContributionModule,
	filters: ContributionFilters | null,
) {
	const encoded = filters === null ? null : JSON.stringify(filters);
	const scope = useMemo(
		() =>
			encoded === null ? null : (JSON.parse(encoded) as ContributionFilters),
		[encoded],
	);
	const key = `${module}:${encoded}`;
	const sequence = useRef(0);
	const pending = useRef<number | null>(null);
	const [state, setState] = useState<ModuleState>({
		key,
		snapshot: null,
		loading: scope !== null,
		refreshing: false,
		error: null,
	});

	useEffect(() => {
		const ticket = ++sequence.current;
		pending.current = null;
		setState({
			key,
			snapshot: null,
			loading: scope !== null,
			refreshing: false,
			error: null,
		});
		if (scope) {
			void fetchContribution(module, scope)
				.then((snapshot) => {
					if (sequence.current === ticket)
						setState({
							key,
							snapshot,
							loading: false,
							refreshing: false,
							error: null,
						});
				})
				.catch((error: unknown) => {
					if (sequence.current === ticket)
						setState({
							key,
							snapshot: null,
							loading: false,
							refreshing: false,
							error:
								error instanceof Error
									? error.message
									: "Could not load statistics",
						});
				});
		}
		return () => {
			++sequence.current;
		};
	}, [module, scope, key]);

	const refresh = useCallback(async () => {
		if (!scope || pending.current !== null) return;
		const ticket = ++sequence.current;
		pending.current = ticket;
		setState((previous) => ({
			key,
			snapshot: previous.key === key ? previous.snapshot : null,
			loading: false,
			refreshing: true,
			error: null,
		}));
		try {
			const snapshot = await calculateContribution(module, scope);
			if (sequence.current === ticket)
				setState({
					key,
					snapshot,
					loading: false,
					refreshing: false,
					error: null,
				});
		} catch (error) {
			if (sequence.current === ticket)
				setState((previous) => ({
					...previous,
					refreshing: false,
					error:
						error instanceof Error
							? error.message
							: "Could not calculate statistics",
				}));
		} finally {
			if (pending.current === ticket) pending.current = null;
		}
	}, [module, scope, key]);

	return {
		...(state.key === key
			? state
			: {
					key,
					snapshot: null,
					loading: scope !== null,
					refreshing: false,
					error: null,
				}),
		refresh,
	};
}
