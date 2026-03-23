/**
 * G2 Security Gate — osv-scanner + gitleaks
 *
 * Runs dependency vulnerability scanning and secret leak detection.
 * Used by pre-push hook and CI.
 *
 * Exit code 0 = all clear, non-zero = gate failed (hard fail).
 */

import { $ } from "bun";

const DIVIDER = "─".repeat(60);

async function runOsvScanner(): Promise<boolean> {
	console.log(`\n${DIVIDER}`);
	console.log("🔍 osv-scanner: scanning bun.lock for vulnerabilities...");
	console.log(DIVIDER);

	try {
		await $`osv-scanner --lockfile=bun.lock --config=.osv-scanner.toml`.quiet();
		console.log("✅ osv-scanner: no vulnerabilities found");
		return true;
	} catch (error) {
		// osv-scanner exits non-zero when vulnerabilities found
		if (error instanceof Error && "exitCode" in error) {
			const proc = error as unknown as { stdout: Buffer; stderr: Buffer };
			console.log(proc.stdout?.toString() || "");
			console.error(proc.stderr?.toString() || "");
		}
		console.error("❌ osv-scanner: vulnerabilities detected");
		return false;
	}
}

async function runGitleaks(): Promise<boolean> {
	console.log(`\n${DIVIDER}`);
	console.log("🔑 gitleaks: scanning for secret leaks...");
	console.log(DIVIDER);

	try {
		// Scan commits not yet pushed (between upstream and HEAD)
		// Fall back to scanning all commits if no upstream
		const upstream = await $`git rev-parse --abbrev-ref @{u} 2>/dev/null`
			.text()
			.catch(() => "");

		if (upstream.trim()) {
			await $`gitleaks git --log-opts=${upstream.trim()}..HEAD --no-banner`.quiet();
		} else {
			await $`gitleaks git --no-banner`.quiet();
		}
		console.log("✅ gitleaks: no leaks found");
		return true;
	} catch (error) {
		if (error instanceof Error && "exitCode" in error) {
			const proc = error as unknown as { stdout: Buffer; stderr: Buffer };
			console.log(proc.stdout?.toString() || "");
			console.error(proc.stderr?.toString() || "");
		}
		console.error("❌ gitleaks: leaks detected");
		return false;
	}
}

// --- Main ---
console.log("🛡️  G2 Security Gate");

const [osvOk, gitleaksOk] = await Promise.all([runOsvScanner(), runGitleaks()]);

console.log(`\n${DIVIDER}`);
if (osvOk && gitleaksOk) {
	console.log("✅ G2 Security Gate: PASSED");
} else {
	console.error("❌ G2 Security Gate: FAILED");
	if (!osvOk) console.error("   → Fix dependency vulnerabilities");
	if (!gitleaksOk) console.error("   → Remove leaked secrets");
	process.exit(1);
}
