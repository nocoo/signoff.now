/**
 * Bundles the SignOff CLI (apps/collect) into one Node executable. The
 * published package contains only dist/signoff.mjs; workspace sources,
 * Bun and dependencies stay out of it.
 */
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const here = import.meta.dir;
const dist = path.join(here, "dist");
const outfile = path.join(dist, "signoff.mjs");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const result = await Bun.build({
	entrypoints: [path.join(here, "../../apps/collect/src/main.ts")],
	target: "node",
	format: "esm",
	minify: false,
});
if (!result.success) {
	for (const log of result.logs) process.stderr.write(`${log}\n`);
	process.exit(1);
}
const [output] = result.outputs;
if (!output) throw new Error("Bundle produced no output");
// The entry keeps its Bun shebang; the published binary runs on Node.
const bundle = `#!/usr/bin/env node\n${(await output.text()).replace(/^#!.*\n(\/\/ @bun\n)?/, "")}`;
await writeFile(outfile, bundle);
await chmod(outfile, 0o755);
process.stdout.write(
	`Built ${path.relative(process.cwd(), outfile)} (${Math.round(bundle.length / 1024)} KB)\n`,
);
