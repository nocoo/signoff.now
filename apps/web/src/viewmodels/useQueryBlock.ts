import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

/** One independent cache query. Provider work is never triggered by reads. */
export function useQueryBlock<T>(
	key: string | null,
	load: (signal: AbortSignal) => Promise<T>,
	intervalMs = 15000,
) {
	const loader = useRef(load);
	loader.current = load;
	const mutationVersion = useRef(0);
	const [state, setState] = useState<{
		key: string | null;
		data: T | null;
		error: string | null;
		errorCode: string | null;
		loaded: boolean;
		refreshing: boolean;
	}>({
		key,
		data: null,
		error: null,
		errorCode: null,
		loaded: false,
		refreshing: false,
	});
	const execute = useRef<() => Promise<unknown>>(() => Promise.resolve());
	useEffect(() => {
		let active = true;
		let pending: Promise<void> | null = null;
		let timer: ReturnType<typeof setTimeout>;
		let controller: AbortController | null = null;
		let failures = 0;
		const run = (): Promise<void> => {
			if (pending) return pending;
			if (!active || key === null || document.visibilityState === "hidden")
				return Promise.resolve();
			clearTimeout(timer);
			controller = new AbortController();
			const signal = controller.signal;
			const version = mutationVersion.current;
			setState((previous) => ({
				key,
				data: previous.key === key ? previous.data : null,
				error: previous.key === key ? previous.error : null,
				errorCode: previous.key === key ? previous.errorCode : null,
				loaded: previous.key === key && previous.loaded,
				refreshing: true,
			}));
			const read = loader.current;
			pending = Promise.resolve()
				.then(() => {
					signal.throwIfAborted();
					return read(signal);
				})
				.then((data) => {
					if (
						active &&
						!signal.aborted &&
						version === mutationVersion.current
					) {
						failures = 0;
						setState({
							key,
							data,
							error: null,
							errorCode: null,
							loaded: true,
							refreshing: false,
						});
					}
				})
				.catch((error: unknown) => {
					if (
						active &&
						!signal.aborted &&
						version === mutationVersion.current
					) {
						failures++;
						setState((previous) => ({
							...previous,
							loaded: true,
							refreshing: false,
							error:
								error instanceof Error
									? error.message
									: "Unable to read cached data",
							errorCode:
								error instanceof ApiError
									? ((error.body as { error?: { code?: string } } | undefined)
											?.error?.code ?? null)
									: null,
						}));
					}
				})
				.finally(() => {
					pending = null;
					if (active && version !== mutationVersion.current)
						setState((previous) => ({ ...previous, refreshing: false }));
					if (active && intervalMs > 0 && document.visibilityState !== "hidden")
						timer = setTimeout(
							() => {
								void run();
							},
							intervalMs * Math.min(4, 2 ** failures),
						);
				});
			return pending;
		};
		execute.current = async () => {
			if (pending) await pending;
			return run();
		};
		const visibility = () => {
			clearTimeout(timer);
			if (document.visibilityState === "hidden") controller?.abort();
			else void execute.current();
		};
		void run();
		document.addEventListener("visibilitychange", visibility);
		return () => {
			active = false;
			controller?.abort();
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [key, intervalMs]);
	const reload = useCallback(() => execute.current(), []);
	// A command receipt can update the visible cache immediately. Reads started
	// before that receipt must not overwrite it with an older observation.
	const update = useCallback((apply: (data: T) => T) => {
		mutationVersion.current++;
		setState((previous) =>
			previous.data === null
				? previous
				: { ...previous, data: apply(previous.data) },
		);
	}, []);
	const current =
		state.key === key
			? state
			: {
					data: null,
					error: null,
					errorCode: null,
					loaded: false,
					refreshing: false,
				};
	return {
		data: current.data,
		error: current.error,
		errorCode: current.errorCode,
		loading: key !== null && !current.loaded,
		refreshing: current.refreshing,
		reload,
		update,
	};
}
