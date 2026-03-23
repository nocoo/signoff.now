/**
 * Barrel re-export of all 8 collector instances.
 *
 * Used by the desktop app to import collectors as a library
 * (in-process call, not CLI spawn).
 */

export { branchesCollector } from "./branches.collector";
export { configCollector } from "./config.collector";
export { contributorsCollector } from "./contributors.collector";
export { filesCollector } from "./files.collector";
export { logsCollector } from "./logs.collector";
export { metaCollector } from "./meta.collector";
export { statusCollector } from "./status.collector";
export { tagsCollector } from "./tags.collector";
