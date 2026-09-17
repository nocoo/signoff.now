import { readAzToken } from "../ado/client.ts";

export type ExecResult = { exitCode: number; stdout: string; stderr: string };

export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

export type AzCheck = {
	ok: boolean;
	detail: string;
};

/** A cached account can exist after login expires; validate and renew the ADO token. */
export async function checkAz(exec: ExecFn): Promise<AzCheck> {
	try {
		await readAzToken(exec);
		return { ok: true, detail: "Azure DevOps token is valid" };
	} catch (e) {
		return {
			ok: false,
			detail: e instanceof Error ? e.message : "az not available",
		};
	}
}
