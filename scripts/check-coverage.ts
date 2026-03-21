/**
 * check-coverage.ts
 *
 * Runs `bun test --coverage` as a subprocess, parses the output, and enforces
 * a minimum line coverage threshold.
 *
 * Rules:
 * - Zero test files (bun test exits with "0 test files") → pass (nothing to cover)
 * - Has tests but coverage < threshold → exit 1
 * - Has tests and coverage >= threshold → pass
 *
 * Usage: bun run scripts/check-coverage.ts [--cwd <dir>]
 */

const THRESHOLD = 90;

async function main(): Promise<void> {
	// Parse optional --cwd argument
	const cwdIdx = process.argv.indexOf("--cwd");
	const cwd = cwdIdx !== -1 ? process.argv[cwdIdx + 1] : process.cwd();

	// Run bun test --coverage as a subprocess
	const proc = Bun.spawn(["bun", "test", "--coverage"], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	const exitCode = await proc.exited;
	const combined = `${stdout}\n${stderr}`;

	// Check for "0 test files" — bun test exits non-zero when no test files found
	if (combined.includes("0 test files")) {
		console.log("✅ No test files found — pass-through");
		process.exit(0);
	}

	// If bun test failed for a reason other than "0 test files", propagate failure
	if (exitCode !== 0) {
		console.error(combined);
		console.error(`❌ bun test exited with code ${exitCode}`);
		process.exit(exitCode);
	}

	// Look for the "All files" summary line in coverage output
	const allFilesLine = combined
		.split("\n")
		.find((line) => line.includes("All files"));

	if (!allFilesLine) {
		// Tests passed but no coverage table — might be --pass-with-no-tests
		console.log("✅ Tests passed, no coverage data — pass-through");
		process.exit(0);
	}

	// Extract percentage columns from the "All files" row
	// Format: " All files  |  85.71  |  92.30  | "
	const columns = allFilesLine
		.split("|")
		.map((col) => col.trim())
		.filter(Boolean);

	// columns[0] = "All files", columns[1] = "% Funcs", columns[2] = "% Lines"
	const lineCoverageStr = columns[2];

	if (!lineCoverageStr) {
		console.log("✅ No line coverage data — pass-through");
		process.exit(0);
	}

	const lineCoverage = Number.parseFloat(lineCoverageStr);

	if (Number.isNaN(lineCoverage)) {
		console.log(
			`✅ Could not parse line coverage "${lineCoverageStr}" — pass-through`,
		);
		process.exit(0);
	}

	// Print the coverage output so it's visible in CI
	console.log(combined);

	if (lineCoverage < THRESHOLD) {
		console.error(
			`❌ Line coverage ${lineCoverage.toFixed(2)}% is below threshold ${THRESHOLD}%`,
		);
		process.exit(1);
	}

	console.log(
		`✅ Line coverage ${lineCoverage.toFixed(2)}% meets threshold ${THRESHOLD}%`,
	);
}

main();
