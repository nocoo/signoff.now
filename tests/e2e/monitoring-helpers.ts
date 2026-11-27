import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import type { AdoPagedClient } from "../../apps/collect/src/ado/client";
import { createCollectionClient } from "../../apps/collect/src/workbench/client";
import { runCollectionOnce } from "../../apps/collect/src/workbench/run";
import { demoWorkspace } from "../../packages/domain/src/demo";
import { observationListSchema } from "../../packages/domain/src/query";

const rawBase = process.env.SIGNOFF_E2E_API_BASE;
const rawMarker = process.env.SIGNOFF_E2E_MARKER;
const rawBun = process.env.SIGNOFF_E2E_BUN;
if (!rawBase || !rawMarker || !rawBun) {
	throw new Error("Missing E2E environment variables");
}
export const base = rawBase;
export const marker = JSON.parse(readFileSync(rawMarker, "utf8")) as {
	runId: string;
	directory: string;
};
if (
	marker.runId !== process.env.SIGNOFF_E2E_RUN_ID ||
	!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)
) {
	throw new Error("E2E state ownership mismatch");
}
export const bun = rawBun;
export const root = path.resolve(import.meta.dirname, "../..");
export const repos = [
	{
		org: "e2e-one",
		project: "Alpha",
		id: "repository-one",
		name: "alpha",
		projectGuid: "project-guid-one",
	},
	{
		org: "e2e-two",
		project: "Équipe",
		id: "repository-two",
		name: "Éditeur",
		projectGuid: "project-guid-two",
	},
];
export const repoUrl = (r: (typeof repos)[number]) =>
	`https://dev.azure.com/${r.org}/${encodeURIComponent(r.project)}/_git/${encodeURIComponent(r.name)}`;
export const now = Math.floor(Date.now() / 1000);
export const api = createCollectionClient({ apiBase: base });
let providerRequests = 0;
export const getProviderRequests = () => providerRequests;
export const fakeAdo: AdoPagedClient = {
	checkAuth: async () => {
		providerRequests++;
	},
	invalidateToken: () => undefined,
	post: async () => {
		throw new Error("Unexpected provider POST");
	},
	get: async () => {
		throw new Error("Unexpected provider GET");
	},
	getPage: async (value) => {
		providerRequests++;
		const url = new URL(value);
		const r = repos.find((repo) => url.pathname.includes(`/${repo.org}/`));
		if (!r) throw new Error(`Unknown repository in URL: ${value}`);
		if (url.pathname.endsWith("/repositories"))
			return {
				data: {
					value: [
						{
							id: r.id,
							name: r.name,
							project: { id: r.projectGuid, name: r.project },
						},
					],
				},
				continuationToken: null,
			};
		if (url.pathname.endsWith("/configurations"))
			return { data: { value: [] }, continuationToken: null };
		expect(url.searchParams.get("searchCriteria.status")).toBe("all");
		return {
			data: {
				value: Array.from({ length: 26 }, (_, i) => ({
					pullRequestId: i + 1,
					title: `${r.name} change ${i + 1}`,
					description: `## Change ${i + 1}\n\n**Ready for review**`,
					status: i === 2 ? "completed" : i === 3 ? "abandoned" : "active",
					isDraft: i === 1,
					creationDate: new Date((now - 86400) * 1000).toISOString(),
					closedDate:
						i === 2 || i === 3
							? new Date((now - 60) * 1000).toISOString()
							: undefined,
					createdBy: { id: "author-one", displayName: "Ada Lovelace" },
					sourceRefName: "refs/heads/feature",
					targetRefName: "refs/heads/main",
					lastMergeSourceCommit: { commitId: "head" },
					lastMergeTargetCommit: { commitId: "target" },
					repository: {
						id: r.id,
						name: r.name,
						project: { id: r.projectGuid, name: r.project },
					},
				})),
			},
			continuationToken: null,
		};
	},
};
export const silent = {
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};
export async function cli(...args: string[]) {
	const child = spawn(
		bun,
		[path.join(root, "apps/collect/src/main.ts"), "--api-base", base, ...args],
		{
			cwd: marker.directory,
			env: { ...process.env, NODE_ENV: "test", PATH: "/nonexistent" },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (v) => {
		stdout += v;
	});
	child.stderr.on("data", (v) => {
		stderr += v;
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	expect(code, `${stderr}\n${stdout}`).toBe(0);
	return JSON.parse(stdout);
}
export async function watchList(...extraArgs: string[]) {
	return observationListSchema.parse(
		await cli("watch", "list", ...(extraArgs.length ? extraArgs : ["--all"])),
	);
}
export async function execute(merged = false, jobId?: string) {
	return runCollectionOnce({
		api,
		jobId,
		makeAdo: () => fakeAdo,
		log: silent,
		collect: async (options) => {
			const target = options.targets?.[0];
			if (!target) throw new Error("Missing collection target");
			const repository = repos.find((repo) => repo.id === target.repository.id);
			if (!repository) {
				throw new Error(`Unknown repository: ${target.repository.id}`);
			}
			const template = demoWorkspace(now).pullRequests[0];
			if (!template) throw new Error("Missing demo pull request template");
			return {
				state: "complete",
				message: "Synthetic provider result",
				pulls: [
					{
						...template,
						...target,
						repository: { id: repository.id, name: repository.name },
						projectId: options.project.id,
						externalId: String(target.number),
						title: `${repository.name} change ${target.number}`,
						draft: target.number === 2,
						state: merged ? "merged" : "open",
						createdAt: now - 86400,
						updatedAt: now - 1,
						observedAt: Math.floor(options.now),
						summaryObservedAt: options.now,
						checksObservedAt: Math.floor(options.now),
						mergedAt: merged ? Math.floor(options.now) - 1 : null,
						headSha: "head",
						targetSha: "target",
						coverage: "complete",
					},
				],
			};
		},
	});
}

export function markMonitoringDone(): void {
	writeFileSync(path.join(marker.directory, "monitoring-done"), "1");
}

// Serializes global watchList/pr-list assertions against other mutating specs.
export async function withWatchLock<T>(
	mode: "exclusive" | "shared",
	fn: () => Promise<T>,
	options?: { waitForMonitoring?: boolean },
): Promise<T> {
	if (process.env.SIGNOFF_E2E_SHARDED === "1") {
		return fn();
	}
	const doneFile = path.join(marker.directory, "monitoring-done");
	const shouldWait = options?.waitForMonitoring ?? true;
	if (shouldWait && process.env.SIGNOFF_E2E_WAIT_MONITORING === "1") {
		while (!existsSync(doneFile)) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	const lockRoot = path.join(marker.directory, "watch-locks");
	mkdirSync(lockRoot, { recursive: true });
	const exclDir = path.join(lockRoot, "exclusive");
	if (mode === "exclusive") {
		while (true) {
			try {
				mkdirSync(exclDir);
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 50));
				continue;
			}
			const hasShared = () =>
				readdirSync(lockRoot).some((name) => name.startsWith("shared-"));
			while (hasShared()) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			break;
		}
		try {
			return await fn();
		} finally {
			rmSync(exclDir, { recursive: true, force: true });
		}
	}
	const sharedDir = path.join(
		lockRoot,
		`shared-${process.pid}-${crypto.randomUUID()}`,
	);
	while (true) {
		const entries = readdirSync(lockRoot);
		if (!entries.includes("exclusive")) {
			mkdirSync(sharedDir);
			if (!readdirSync(lockRoot).includes("exclusive")) break;
			rmSync(sharedDir, { recursive: true, force: true });
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	try {
		return await fn();
	} finally {
		rmSync(sharedDir, { recursive: true, force: true });
	}
}
