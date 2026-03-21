/**
 * File search utility using Fuse.js for fuzzy matching.
 *
 * Provides quick file finder (Cmd+P style) functionality
 * by searching through a flat list of file paths.
 */

import Fuse, { type IFuseOptions } from "fuse.js";

export interface SearchableFile {
	/** Relative path from workspace root. */
	path: string;
	/** Filename only (for display and primary matching). */
	name: string;
}

export interface SearchResult {
	file: SearchableFile;
	/** Fuse.js relevance score (0 = perfect match). */
	score: number;
}

const FUSE_OPTIONS: IFuseOptions<SearchableFile> = {
	keys: [
		{ name: "name", weight: 0.7 },
		{ name: "path", weight: 0.3 },
	],
	threshold: 0.4,
	includeScore: true,
	shouldSort: true,
};

/**
 * Create a fuzzy search index for a list of files.
 * Returns a search function.
 */
export function createFileSearchIndex(files: SearchableFile[]) {
	const fuse = new Fuse(files, FUSE_OPTIONS);

	return function search(query: string, limit = 20): SearchResult[] {
		if (!query.trim()) return [];
		return fuse.search(query, { limit }).map((result) => ({
			file: result.item,
			score: result.score ?? 0,
		}));
	};
}

/** Extract filename from a path. */
export function fileNameFromPath(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] ?? path;
}

/** Convert a flat list of paths to searchable files. */
export function pathsToSearchableFiles(paths: string[]): SearchableFile[] {
	return paths.map((path) => ({
		path,
		name: fileNameFromPath(path),
	}));
}
