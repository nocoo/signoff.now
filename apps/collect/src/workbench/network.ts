import type { NetworkEvent, NetworkKind } from "@signoff/domain/network";
import type { FetchFn } from "../ado/client";

export function adoRequestKind(url: string): NetworkKind {
	const path = new URL(url).pathname.toLowerCase();
	if (/\/_apis\/(build|policy)\//.test(path) || /\/statuses(?:\/|$)/.test(path))
		return "adoChecks";
	if (/\/pullrequests\/[^/]+/.test(path)) return "adoDetails";
	return "adoDiscovery";
}
export function measuredAdoFetch(
	fetcher: FetchFn,
	report: (event: NetworkEvent) => Promise<unknown>,
	warn: (message: string) => void,
): FetchFn {
	return async (url, init) => {
		const event: NetworkEvent = {
			id: crypto.randomUUID(),
			kind: adoRequestKind(url),
			at: Math.floor(Date.now() / 1000),
		};
		try {
			return await fetcher(url, init);
		} finally {
			try {
				await report(event);
			} catch {
				warn("Could not record ADO request activity");
			}
		}
	};
}
