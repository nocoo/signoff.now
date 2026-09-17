import { type RefObject, useEffect, useRef } from "react";

export function useViewportCollection(
	container: RefObject<HTMLElement | null>,
	rowIds: string[],
	collect: (ids: string[]) => unknown,
	enabled: boolean,
	selectedId?: string,
) {
	const latest = useRef(collect);
	latest.current = collect;
	const rowKey = JSON.stringify(rowIds);
	useEffect(() => {
		if (!enabled) return;
		const allowed = new Set<string>(JSON.parse(rowKey));
		const visible = new Set<string>();
		let active = true;
		let pending: ReturnType<typeof setTimeout>;
		const run = () => {
			if (active && document.visibilityState === "visible")
				void latest.current(selectedId ? [selectedId] : [...visible]);
		};
		const schedule = () => {
			clearTimeout(pending);
			pending = setTimeout(run, 600);
		};
		const observer =
			typeof IntersectionObserver === "undefined"
				? null
				: new IntersectionObserver((entries) => {
						if (!active) return;
						for (const entry of entries) {
							const id = (entry.target as HTMLElement).dataset.pullId;
							if (!id || !allowed.has(id)) continue;
							if (entry.isIntersecting && entry.intersectionRatio > 0)
								visible.add(id);
							else visible.delete(id);
						}
						schedule();
					});
		for (const row of container.current?.querySelectorAll<HTMLElement>(
			"[data-pull-id]",
		) ?? []) {
			if (allowed.has(row.dataset.pullId ?? "")) observer?.observe(row);
		}
		schedule();
		const timer = setInterval(run, 5000);
		document.addEventListener("visibilitychange", schedule);
		return () => {
			active = false;
			clearTimeout(pending);
			clearInterval(timer);
			observer?.disconnect();
			document.removeEventListener("visibilitychange", schedule);
		};
	}, [container, rowKey, enabled, selectedId]);
}
