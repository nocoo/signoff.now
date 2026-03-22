/**
 * Native modules that must be externalized from the Vite bundle.
 * They are loaded at runtime via Node.js require() and need
 * native rebuilds for Electron's Node.js version.
 */
export const runtimeDependencies = [
	"better-sqlite3",
	"node-pty",
	"@parcel/watcher",
] as const;
