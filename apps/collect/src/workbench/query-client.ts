import {
	parsePullReference,
	parseRepositoryReference,
} from "@signoff/domain/monitoring";
import {
	type FetchLike,
	isPipelineClientError,
	pipelineRequest,
} from "../pipeline/client";
import { collectionApiBase } from "./client";

export type QueryOptions = {
	apiBase?: string;
	timeoutMs?: number;
	fetchImpl?: FetchLike;
};
export function queryRequest(
	options: QueryOptions,
	method: string,
	path: string,
	body?: unknown,
) {
	return Promise.resolve().then(() =>
		pipelineRequest(
			{
				apiBase: collectionApiBase(
					options.apiBase ?? process.env.SIGNOFF_QUERY_API_BASE,
				),
				timeoutMs: options.timeoutMs ?? 5000,
				fetchImpl: options.fetchImpl ?? globalThis.fetch,
				redirect: "error",
			},
			method,
			path,
			body,
		),
	);
}

export function parsePrArgument(
	value: string,
	repository?: string,
): { pullId: string } | { url: string } {
	if (/^\d+$/.test(value)) {
		if (!repository)
			throw new TypeError(
				"A PR number requires --repo with its complete repository URL",
			);
		const repo = parseRepositoryReference(repository);
		const url = `${repo.repositoryUrl}/${repo.provider === "ado" ? "pullrequest" : "pull"}/${value}`;
		parsePullReference(url);
		return { url };
	}
	if (/^https?:/i.test(value)) {
		parsePullReference(value);
		return { url: value };
	}
	if (!value || value.length > 240 || /\s/.test(value))
		throw new TypeError("Provide a PR URL, cached ID, or a number with --repo");
	return { pullId: value };
}

export async function readAllPages<
	T extends {
		data: unknown[];
		page: { limit: number; total: number; nextCursor: string | null };
	},
>(read: (cursor?: string) => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			const first = await read();
			const data = [...first.data];
			const seen = new Set<string>();
			let cursor = first.page.nextCursor;
			while (cursor) {
				if (seen.has(cursor))
					throw new TypeError("Cache service returned a repeated cursor");
				seen.add(cursor);
				const next = await read(cursor);
				data.push(...next.data);
				cursor = next.page.nextCursor;
			}
			return { ...first, data, page: { ...first.page, nextCursor: null } };
		} catch (error) {
			if (
				attempt >= 2 ||
				!isPipelineClientError(error) ||
				(error.body as { error?: { code?: string } })?.error?.code !==
					"SNAPSHOT_CHANGED"
			)
				throw error;
		}
	}
}
