import type { PipelineClient } from "../pipeline/client.ts";
import { isPipelineClientError } from "../pipeline/client.ts";

export type HttpCheck = {
	ok: boolean;
	detail: string;
};

export async function checkBootstrapReachable(
	client: PipelineClient,
): Promise<HttpCheck> {
	try {
		const snap = await client.bootstrap();
		return {
			ok: true,
			detail: `pipelineConfigVersion=${snap.settings.pipelineConfigVersion}`,
		};
	} catch (e) {
		if (isPipelineClientError(e)) {
			return { ok: false, detail: `HTTP ${e.status}` };
		}
		return {
			ok: false,
			detail: e instanceof Error ? e.message : "bootstrap failed",
		};
	}
}
