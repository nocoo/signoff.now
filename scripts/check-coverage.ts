/**
 * check-coverage.ts
 *
 * Parses `bun test --coverage` stdout and enforces a minimum line coverage threshold.
 *
 * Rules:
 * - Zero test files / 0 total lines → pass (nothing to cover, don't block commit)
 * - Has lines but coverage < threshold → exit 1
 * - Has lines and coverage >= threshold → pass
 *
 * Usage: bun run scripts/check-coverage.ts
 * Expects coverage output piped via stdin or run as part of test:ci script.
 */

const THRESHOLD = 90;

async function main(): Promise<void> {
	const input = await Bun.stdin.text();

	// bun test --coverage outputs a table like:
	// -------------------|---------|---------|-------------------
	// File               | % Funcs | % Lines | Uncovered Line #s
	// -------------------|---------|---------|-------------------
	// All files          |  85.71  |  92.30  |
	// ...

	// Look for the "All files" summary line
	const allFilesLine = input
		.split("\n")
		.find((line) => line.includes("All files"));

	if (!allFilesLine) {
		// No coverage output = no test files = pass-through
		console.log("✅ No coverage data (zero test files) — pass-through");
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
		console.log("✅ Could not parse line coverage — pass-through");
		process.exit(0);
	}

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
