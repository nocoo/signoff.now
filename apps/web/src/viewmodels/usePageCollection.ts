import type { CollectionView } from "@signoff/domain/collection";
import { useEffect, useRef } from "react";

export type CollectionPage = Omit<CollectionView, "viewId" | "sequence">;

/** Browser presence selects the page; the collector owns all jobs and cooldowns. */
export function usePageCollection(
	publish: (page: CollectionPage) => Promise<boolean>,
	enabled: boolean,
	pageKey: string,
	pullIds: string[],
) {
	const latest = useRef({ publish, pullIds });
	latest.current = { publish, pullIds };
	const sentSelection = useRef("");
	const selection = JSON.stringify(pullIds);
	useEffect(() => {
		if (!enabled) return;
		const send = (refresh: boolean) => {
			const visible = document.visibilityState === "visible";
			const ids = visible ? latest.current.pullIds : [];
			sentSelection.current = JSON.stringify(ids);
			void latest.current.publish({
				visible,
				refresh: visible && refresh,
				pageKey,
				pullIds: ids,
			});
		};
		send(true);
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") send(false);
		}, 15_000);
		const visibility = () => send(true);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", visibility);
			void latest.current.publish({
				visible: false,
				refresh: false,
				pageKey,
				pullIds: [],
			});
		};
	}, [enabled, pageKey]);
	useEffect(() => {
		if (
			!enabled ||
			document.visibilityState !== "visible" ||
			sentSelection.current === selection
		)
			return;
		sentSelection.current = selection;
		void latest.current.publish({
			visible: true,
			refresh: false,
			pageKey,
			pullIds: latest.current.pullIds,
		});
	}, [enabled, pageKey, selection]);
}
