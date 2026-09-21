import { useEffect } from "react";
import { sendAiPresence, tickAi } from "@/models/aiScheduleApi";
export function useAiPresence(source: "cli" | "demo") {
	useEffect(() => {
		const id = crypto.randomUUID();
		let sequence = 0,
			active = true,
			ticking = false;
		const publish = (visible: boolean) => {
			const revision = ++sequence;
			void sendAiPresence(id, revision, source, visible)
				.then(async () => {
					if (
						!active ||
						revision !== sequence ||
						!visible ||
						ticking ||
						document.visibilityState !== "visible" ||
						!document.hasFocus()
					)
						return;
					ticking = true;
					try {
						await tickAi();
					} finally {
						ticking = false;
					}
				})
				.catch(() => undefined);
		};
		const sync = () =>
			publish(document.visibilityState === "visible" && document.hasFocus());
		const hide = () => publish(false);
		const timer = setInterval(sync, 5000);
		document.addEventListener("visibilitychange", sync);
		window.addEventListener("focus", sync);
		window.addEventListener("blur", hide);
		window.addEventListener("pagehide", hide);
		window.addEventListener("pageshow", sync);
		sync();
		return () => {
			active = false;
			clearInterval(timer);
			document.removeEventListener("visibilitychange", sync);
			window.removeEventListener("focus", sync);
			window.removeEventListener("blur", hide);
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("pageshow", sync);
			publish(false);
		};
	}, [source]);
}
