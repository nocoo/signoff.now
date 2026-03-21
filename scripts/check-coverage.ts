/**
 * check-coverage.ts
 *
 * Runs `bun test --pass-with-no-tests --coverage` as a subprocess, parses the
 * output, and enforces a minimum line coverage threshold.
 *
 * Designed to be called by each package's `test:ci` script via turbo.
 * Runs in the package's cwd, respecting its bunfig.toml and test-setup.ts.
 *
 * Rules:
 * - Zero test files → pass (--pass-with-no-tests ensures exit 0)
 * - Tests fail → propagate exit code
 * - Tests pass but coverage < threshold → exit 1
 * - Tests pass and coverage >= threshold → pass
 *
 * Usage: bun run <path-to>/scripts/check-coverage.ts
 */

const THRESHOLD = 90;

async function main(): Promise<void> {
	// Run bun test with --pass-with-no-tests to avoid failing on empty packages,
	// and --coverage to produce coverage output for threshold checking.
	const proc = Bun.spawn(
		["bun", "test", "--pass-with-no-tests", "--coverage"],
		{
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	const exitCode = await proc.exited;
	const combined = `${stdout}\n${stderr}`;

	// If bun test failed (actual test failures), propagate
	if (exitCode !== 0) {
		process.stdout.write(combined);
		console.error(`❌ bun test exited with code ${exitCode}`);
		process.exit(exitCode);
	}

	// Look for the "All files" summary line in coverage output
	const allFilesLine = combined
		.split("\n")
		.find((line) => line.includes("All files"));

	if (!allFilesLine) {
		// Tests passed but no coverage table — no test files or no coverable code
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
	process.stdout.write(combined);

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
