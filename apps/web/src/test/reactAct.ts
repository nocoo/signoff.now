import { act as reactAct } from "react";

/** React `act()` is awaitable for async callbacks but typed as `void` in @types/react. */
export function awaitReactAct(run: () => unknown): Promise<void> {
	return reactAct(run) as Promise<void>;
}
