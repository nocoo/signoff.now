import { networkActivitySchema } from "@signoff/domain/network";
import { apiFetch } from "@/lib/api";
import { useQueryBlock } from "./useQueryBlock";

export function useNetworkActivity() {
	return useQueryBlock(
		"network-activity",
		async (signal) =>
			networkActivitySchema.parse(
				await apiFetch("/api/query/v1/network", { signal }),
			),
		10000,
	);
}
