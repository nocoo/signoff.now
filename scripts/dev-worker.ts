import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WorkerHealth } from "./dev-worker-health";

const root = fileURLToPath(new URL("../", import.meta.url));
const shutdown = new AbortController();
let child: ChildProcess | undefined;

function signalChild(signal: NodeJS.Signals) {
	if (!child?.pid) return;
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

async function stopChild() {
	signalChild("SIGTERM");
	await delay(1000);
	signalChild("SIGKILL");
	child = undefined;
}

function startChild() {
	const node = Bun.which("node");
	if (!node) throw new Error("Local Worker requires Node.js");
	child = spawn(
		node,
		[
			"node_modules/wrangler/bin/wrangler.js",
			"dev",
			"--port",
			"37042",
			"--local",
			"--local-upstream",
			"localhost",
			"--var",
			"SIGNOFF_DEMO_MODE:1",
		],
		{ cwd: root, detached: true, stdio: "inherit" },
	);
	child.once("error", (error) => {
		console.error("Local Worker failed to start:", error.message);
		process.exitCode = 1;
		shutdown.abort();
	});
	return new WorkerHealth(Date.now());
}

async function healthy(): Promise<boolean> {
	try {
		const response = await fetch("http://127.0.0.1:37042/api/live", {
			signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(5000)]),
		});
		const data = (await response.json()) as { service?: string; ok?: boolean };
		return response.ok && data.service === "signoff" && data.ok === true;
	} catch {
		return false;
	}
}

async function main() {
	const port = createServer();
	await new Promise<void>((resolve, reject) => {
		port.once("error", reject);
		port.listen(37042, "127.0.0.1", resolve);
	});
	await new Promise<void>((resolve, reject) =>
		port.close((error) => (error ? reject(error) : resolve())),
	);
	for (const signal of ["SIGINT", "SIGTERM"] as const)
		process.once(signal, () => shutdown.abort());
	let health = startChild();
	try {
		while (!shutdown.signal.aborted) {
			await delay(15000, undefined, { signal: shutdown.signal });
			const available = await healthy();
			if (shutdown.signal.aborted) break;
			if (health.check(Date.now(), available) === "restart") {
				console.error(
					"Local API failed three health checks; restarting its Worker.",
				);
				await stopChild();
				if (!shutdown.signal.aborted) health = startChild();
			}
		}
	} catch (error) {
		if (!shutdown.signal.aborted) throw error;
	} finally {
		await stopChild();
	}
}

await main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
