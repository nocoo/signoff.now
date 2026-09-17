import { useEffect, useState } from "react";

export function useMinuteNow(): number {
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
	useEffect(() => {
		const update = () => setNow(Math.floor(Date.now() / 1000));
		const onVisibility = () => {
			if (document.visibilityState === "visible") update();
		};
		const timer = setInterval(update, 60_000);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);
	return now;
}
