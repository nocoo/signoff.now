export type ParsedJevRequest = {
	model: string;
	state: Record<string, unknown>;
	questions: Record<string, unknown>;
};

export function parseJevRequestBody(init?: RequestInit): ParsedJevRequest {
	const headers = new Headers(
		(init?.headers ?? {}) as Record<string, string> | Headers,
	);
	const body = init?.body;
	if (body instanceof Uint8Array && headers.get("content-encoding") === "zstd")
		return JSON.parse(
			new TextDecoder().decode(Bun.zstdDecompressSync(body)),
		) as ParsedJevRequest;
	return JSON.parse(String(body)) as ParsedJevRequest;
}
