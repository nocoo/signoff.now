import { useCallback, useEffect, useRef, useState } from "react";

/** One independent cache query. Provider work is never triggered by reads. */
export function useQueryBlock<T>(
	key: string | null,
	load: (signal: AbortSignal) => Promise<T>,
	intervalMs = 15000,
) {
	const loader = useRef(load);
	loader.current = load;
	const [state, setState] = useState<{
		key: string | null;
		data: T | null;
		error: string | null;
		loaded: boolean;
		refreshing: boolean;
	}>({ key, data: null, error: null, loaded: false, refreshing: false });
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
			setState((previous) => ({
				key,
				data: previous.key === key ? previous.data : null,
				error: previous.key === key ? previous.error : null,
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
					if (active && !signal.aborted) {
						failures = 0;
						setState({
							key,
							data,
							error: null,
							loaded: true,
							refreshing: false,
						});
					}
				})
				.catch((error: unknown) => {
					if (active && !signal.aborted) {
						failures++;
						setState((previous) => ({
							...previous,
							loaded: true,
							refreshing: false,
							error:
								error instanceof Error
									? error.message
									: "Unable to read cached data",
						}));
					}
				})
				.finally(() => {
					pending = null;
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
	const current =
		state.key === key
			? state
			: { data: null, error: null, loaded: false, refreshing: false };
	return {
		data: current.data,
		error: current.error,
		loading: key !== null && !current.loaded,
		refreshing: current.refreshing,
		reload,
	};
}
