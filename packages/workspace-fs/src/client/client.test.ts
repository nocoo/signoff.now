import { describe, expect, test } from "bun:test";
import { createFsClient } from "./index";

function createMockTransport() {
	const calls: Array<{ type: string; method: string; input: unknown }> = [];
	return {
		calls,
		request: async (method: string, input: unknown) => {
			calls.push({ type: "request", method, input });
			return {} as any;
		},
		subscribe: (method: string, input: unknown) => {
			calls.push({ type: "subscribe", method, input });
			return (async function* () {})();
		},
	};
}

describe("createFsClient", () => {
	test("listDirectory delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { absolutePath: "/workspace" };
		await client.listDirectory(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "listDirectory", input },
		]);
	});

	test("readFile delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { absolutePath: "/workspace/file.txt", encoding: "utf-8" };
		await client.readFile(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "readFile", input },
		]);
	});

	test("getMetadata delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { absolutePath: "/workspace/file.txt" };
		await client.getMetadata(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "getMetadata", input },
		]);
	});

	test("writeFile delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = {
			absolutePath: "/workspace/out.txt",
			content: "hello",
			options: { create: true, overwrite: true },
		};
		await client.writeFile(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "writeFile", input },
		]);
	});

	test("createDirectory delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { absolutePath: "/workspace/new-dir", recursive: true };
		await client.createDirectory(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "createDirectory", input },
		]);
	});

	test("deletePath delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { absolutePath: "/workspace/old.txt", permanent: false };
		await client.deletePath(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "deletePath", input },
		]);
	});

	test("movePath delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = {
			sourceAbsolutePath: "/workspace/a.txt",
			destinationAbsolutePath: "/workspace/b.txt",
		};
		await client.movePath(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "movePath", input },
		]);
	});

	test("copyPath delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = {
			sourceAbsolutePath: "/workspace/a.txt",
			destinationAbsolutePath: "/workspace/a-copy.txt",
		};
		await client.copyPath(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "copyPath", input },
		]);
	});

	test("searchFiles delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { query: "hello", limit: 10 };
		await client.searchFiles(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "searchFiles", input },
		]);
	});

	test("searchContent delegates to transport.request", async () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { query: "TODO", includeHidden: true };
		await client.searchContent(input);
		expect(transport.calls).toEqual([
			{ type: "request", method: "searchContent", input },
		]);
	});

	test("watchPath delegates to transport.subscribe", () => {
		const transport = createMockTransport();
		const client = createFsClient(transport);
		const input = { absolutePath: "/workspace", recursive: true };
		client.watchPath(input);
		expect(transport.calls).toEqual([
			{ type: "subscribe", method: "watchPath", input },
		]);
	});
});
