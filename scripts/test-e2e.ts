import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every run owns its config, assets, database, ports and child process group.
// No daily .wrangler state, production credentials or provider network is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await realpath(
	await mkdtemp(path.join(tmpdir(), "signoff-e2e-")),
);
const runId = crypto.randomUUID();
const marker = path.join(directory, "owner.json");
await writeFile(
	marker,
	JSON.stringify({ runId, uid: process.getuid?.(), directory }),
);
const env: NodeJS.ProcessEnv = {
	...process.env,
	NODE_ENV: "test",
	WRANGLER_SEND_METRICS: "false",
	CI: "1",
};
delete env.CLOUDFLARE_API_TOKEN;
delete env.CLOUDFLARE_API_KEY;
const bun = process.execPath;
const node = Bun.which("node");
if (!node) throw new Error("Wrangler E2E requires Node.js");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const config = path.join(directory, "wrangler.json");
const workerLog = path.join(directory, "worker.log");
let worker: ChildProcess | undefined;
let stopped = false;
async function freePort() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No test port allocated");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}
async function command(
	args: string[],
	cwd = root,
	extraEnv: Record<string, string> = {},
	executable = bun,
) {
	const child = spawn(executable, args, {
		cwd,
		env: { ...env, ...extraEnv },
		stdio: "inherit",
	});
	const code = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (value) => resolve(value ?? 1));
	});
	if (code)
		throw new Error(
			`E2E command failed (${code}): ${args.slice(0, 3).join(" ")}`,
		);
}
async function cleanup() {
	if (stopped) return;
	stopped = true;
	if (worker?.pid) {
		try {
			process.kill(-worker.pid, "SIGTERM");
		} catch {
			/* Already stopped. */
		}
		await Promise.race([
			new Promise((resolve) => worker?.once("exit", resolve)),
			Bun.sleep(1000),
		]);
		try {
			process.kill(-worker.pid, "SIGKILL");
		} catch {
			/* Process group exited. */
		}
	}
	await mkdir(path.join(root, "test-results"), { recursive: true });
	try {
		await copyFile(workerLog, path.join(root, "test-results/e2e-worker.log"));
	} catch {
		/* Failed before startup. */
	}
	const ownership = JSON.parse(await readFile(marker, "utf8"));
	if (
		ownership.runId !== runId ||
		ownership.directory !== directory ||
		ownership.uid !== process.getuid?.() ||
		(await stat(directory)).uid !== process.getuid?.()
	)
		throw new Error("Refusing to remove unowned E2E state");
	await rm(directory, { recursive: true });
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, () => {
		void cleanup().finally(() => process.exit(130));
	});

try {
	const port = await freePort();
	const inspectorPort = await freePort();
	const base = `http://127.0.0.1:${port}`;
	await writeFile(
		config,
		JSON.stringify({
			name: "signoff-e2e",
			main: path.join(root, "packages/worker/src/index.ts"),
			compatibility_date: "2026-07-07",
			vars: { SIGNOFF_DEMO_MODE: "1" },
			assets: {
				directory: path.join(directory, "assets"),
				binding: "ASSETS",
				not_found_handling: "single-page-application",
				run_worker_first: ["/api/*"],
			},
			d1_databases: [
				{
					binding: "DB",
					database_name: "signoff-e2e",
					database_id: "00000000-0000-0000-0000-000000000001",
					migrations_dir: path.join(root, "packages/db/migrations"),
				},
			],
		}),
	);
	await command(
		["x", "vite", "build", "--outDir", path.join(directory, "assets")],
		path.join(root, "apps/web"),
	);
	await command(
		[
			wrangler,
			"d1",
			"migrations",
			"apply",
			"signoff-e2e",
			"--local",
			"--config",
			config,
			"--persist-to",
			path.join(directory, "state"),
		],
		root,
		{},
		node,
	);
	const output = createWriteStream(workerLog);
	await command(
		[
			wrangler,
			"d1",
			"execute",
			"signoff-e2e",
			"--local",
			"--config",
			config,
			"--persist-to",
			path.join(directory, "state"),
			"--file",
			path.join(root, "tests/e2e/sample-project.sql"),
		],
		root,
		{},
		node,
	);
	worker = spawn(
		node,
		[
			wrangler,
			"dev",
			"--config",
			config,
			"--local",
			"--local-upstream",
			"localhost",
			"--ip",
			"127.0.0.1",
			"--port",
			String(port),
			"--inspector-ip",
			"127.0.0.1",
			"--inspector-port",
			String(inspectorPort),
			"--persist-to",
			path.join(directory, "state"),
		],
		{ cwd: directory, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	worker.stdout?.pipe(output);
	worker.stderr?.pipe(output);
	let ready = false;
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			if (
				(await fetch(`${base}/api/live`, { signal: AbortSignal.timeout(1000) }))
					.ok
			) {
				ready = true;
				break;
			}
		} catch {
			/* Waiting for owned Worker startup. */
		}
		if (worker.exitCode !== null) break;
		await Bun.sleep(250);
	}
	if (!ready)
		throw new Error(
			`Disposable Worker failed to start: ${await readFile(workerLog, "utf8")}`,
		);
	await command(["x", "playwright", "test"], root, {
		SIGNOFF_E2E_API_BASE: base,
		SIGNOFF_E2E_MARKER: marker,
		SIGNOFF_E2E_RUN_ID: runId,
		SIGNOFF_E2E_BUN: bun,
	});
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await cleanup();
}
