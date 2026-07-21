export type ExecResult = { exitCode: number; stdout: string; stderr: string };

export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

export type AzCheck = {
	ok: boolean;
	detail: string;
};

/** Check `az account show` without calling ADO REST. */
export async function checkAz(exec: ExecFn): Promise<AzCheck> {
	try {
		const r = await exec("az", ["account", "show", "-o", "json"]);
		if (r.exitCode !== 0) {
			return {
				ok: false,
				detail: r.stderr.trim() || "az account show failed (not logged in?)",
			};
		}
		let name = "logged in";
		try {
			const j = JSON.parse(r.stdout) as { user?: { name?: string } };
			if (j.user?.name) {
				name = j.user.name;
			}
		} catch {
			// ignore parse errors; login still succeeded
		}
		return { ok: true, detail: name };
	} catch (e) {
		return {
			ok: false,
			detail: e instanceof Error ? e.message : "az not available",
		};
	}
}
