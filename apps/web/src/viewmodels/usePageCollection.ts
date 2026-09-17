import { useEffect, useRef } from "react";

/** Retry due page work; the viewmodel enforces the configured cache interval. */
export function usePageCollection(
	collect: (signal: AbortSignal) => unknown,
	enabled: boolean,
	pageKey: string,
) {
	const latest = useRef(collect);
	latest.current = collect;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new page needs its own initial collection
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		let pending: ReturnType<typeof setTimeout>;
		const run = () => {
			if (document.visibilityState === "visible")
				void latest.current(controller.signal);
		};
		const schedule = () => {
			clearTimeout(pending);
			pending = setTimeout(run, 600);
		};
		schedule();
		const timer = setInterval(run, 5000);
		document.addEventListener("visibilitychange", schedule);
		return () => {
			controller.abort();
			clearTimeout(pending);
			clearInterval(timer);
			document.removeEventListener("visibilitychange", schedule);
		};
	}, [enabled, pageKey]);
}
