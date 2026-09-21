import { useCallback } from "react";

export function usePullTableLayout() {
	return useCallback((container: HTMLDivElement | null) => {
		if (!container) return;
		const table = container.querySelector("table");
		if (!table) return;
		const updateColumns = () => {
			delete container.dataset.hiddenColumns;
			const hidden: string[] = [];
			for (const column of ["author", "repository"]) {
				if (table.scrollWidth <= container.clientWidth + 1) break;
				hidden.push(column);
				container.dataset.hiddenColumns = hidden.join(" ");
			}
		};
		const resize = new ResizeObserver(updateColumns);
		const content = new MutationObserver(updateColumns);
		resize.observe(container);
		content.observe(table, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		document.fonts?.addEventListener("loadingdone", updateColumns);
		updateColumns();
		return () => {
			resize.disconnect();
			content.disconnect();
			document.fonts?.removeEventListener("loadingdone", updateColumns);
		};
	}, []);
}
