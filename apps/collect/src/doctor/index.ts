import type { FsLike } from "../cache/bootstrap.ts";
import { ensureDataDirs } from "../cache/bootstrap.ts";
import type { CollectEnv } from "../config/env.ts";
import { requireWriteToken } from "../config/env.ts";
import type { PipelineClient } from "../pipeline/client.ts";
import type { ExecFn } from "./az.ts";
import { checkAz } from "./az.ts";
import { checkBootstrapReachable } from "./http.ts";

export type DoctorCheck = {
	name: string;
	ok: boolean;
	detail: string;
};

export type DoctorResult = {
	ok: boolean;
	checks: DoctorCheck[];
};

export async function runDoctor(opts: {
	env: CollectEnv;
	exec: ExecFn;
	fs: FsLike;
	client: PipelineClient;
}): Promise<DoctorResult> {
	const checks: DoctorCheck[] = [];

	const az = await checkAz(opts.exec);
	checks.push({ name: "az", ok: az.ok, detail: az.detail });

	try {
		await ensureDataDirs(opts.fs, opts.env.dataDir);
		// Probe a real write — mkdir alone is a false PASS on read-only trees.
		const probe = `${opts.env.dataDir.replace(/\/+$/, "")}/.write-probe`;
		await opts.fs.writeFile(probe, "ok\n");
		try {
			await opts.fs.unlink?.(probe);
		} catch {
			// Best-effort cleanup; write success already proved writability.
		}
		checks.push({
			name: ".data writable",
			ok: true,
			detail: opts.env.dataDir,
		});
	} catch (e) {
		checks.push({
			name: ".data writable",
			ok: false,
			detail: e instanceof Error ? e.message : "cannot write .data",
		});
	}

	const http = await checkBootstrapReachable(opts.client);
	checks.push({ name: "bootstrap", ok: http.ok, detail: http.detail });

	const tokenErr = requireWriteToken(opts.env);
	if (opts.env.isLoopback) {
		checks.push({
			name: "pipeline token",
			ok: true,
			detail: "skipped (loopback)",
		});
	} else if (tokenErr) {
		checks.push({ name: "pipeline token", ok: false, detail: tokenErr });
	} else {
		checks.push({
			name: "pipeline token",
			ok: true,
			detail: "configured",
		});
	}

	return {
		ok: checks.every((c) => c.ok),
		checks,
	};
}

export function formatDoctor(result: DoctorResult): string {
	const lines = result.checks.map(
		(c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`,
	);
	lines.push(result.ok ? "doctor: all checks passed" : "doctor: failures");
	return lines.join("\n");
}
