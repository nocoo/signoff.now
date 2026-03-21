import { describe, expect, test } from "bun:test";
import { createAsyncQueue } from "./service";

describe("createAsyncQueue", () => {
	test("delivers pushed values via async iterator", async () => {
		const queue = createAsyncQueue<number>(async (push) => {
			push(1);
			push(2);
			push(3);
			return async () => {};
		});

		const values: number[] = [];
		let count = 0;
		for await (const value of queue) {
			values.push(value);
			count++;
			if (count >= 3) break;
		}
		expect(values).toEqual([1, 2, 3]);
	});

	test("waits for values when queue is empty", async () => {
		let pushFn: ((value: number) => void) | null = null;
		const queue = createAsyncQueue<number>(async (push) => {
			pushFn = push;
			return async () => {};
		});

		// Wait a tick for subscribe to resolve
		await new Promise((r) => setTimeout(r, 10));

		// Push value after iterator starts waiting
		const iterPromise = (async () => {
			const iter = queue[Symbol.asyncIterator]();
			return iter.next();
		})();

		await new Promise((r) => setTimeout(r, 10));
		if (pushFn) {
			(pushFn as (value: number) => void)(42);
		}

		const result = await iterPromise;
		expect(result.value).toBe(42);
		expect(result.done).toBe(false);
	});

	test("returns done:true after return() is called", async () => {
		const queue = createAsyncQueue<number>(async (push) => {
			push(1);
			return async () => {};
		});

		const iter = queue[Symbol.asyncIterator]();
		const first = await iter.next();
		expect(first.value).toBe(1);

		const returnResult = await iter.return?.(undefined);
		expect(returnResult?.done).toBe(true);

		const afterReturn = await iter.next();
		expect(afterReturn.done).toBe(true);
	});

	test("ignores pushed values after close", async () => {
		let pushFn: ((value: number) => void) | null = null;
		const queue = createAsyncQueue<number>(async (push) => {
			pushFn = push;
			return async () => {};
		});

		await new Promise((r) => setTimeout(r, 10));

		const iter = queue[Symbol.asyncIterator]();
		await iter.return?.(undefined);

		// Push after close — should not throw
		if (pushFn) {
			(pushFn as (value: number) => void)(99);
		}
	});

	test("calls cleanup when return() is called", async () => {
		let cleaned = false;
		const queue = createAsyncQueue<number>(async (push) => {
			push(1);
			return async () => {
				cleaned = true;
			};
		});

		const iter = queue[Symbol.asyncIterator]();
		await iter.next();

		// Wait for subscribe to resolve and set cleanup
		await new Promise((r) => setTimeout(r, 10));

		await iter.return?.(undefined);
		expect(cleaned).toBe(true);
	});

	test("rejects waiters when subscribe throws", async () => {
		const queue = createAsyncQueue<number>(async () => {
			throw new Error("subscribe failed");
		});

		const iter = queue[Symbol.asyncIterator]();
		await expect(iter.next()).rejects.toThrow("subscribe failed");
	});

	test("calls cleanup immediately if closed before subscribe resolves", async () => {
		let cleaned = false;
		const queue = createAsyncQueue<number>(async (push) => {
			// Simulate slow subscribe
			await new Promise((r) => setTimeout(r, 50));
			push(1);
			return async () => {
				cleaned = true;
			};
		});

		const iter = queue[Symbol.asyncIterator]();
		// Close immediately before subscribe resolves
		await iter.return?.(undefined);

		// Wait for subscribe to finish and notice closed state
		await new Promise((r) => setTimeout(r, 100));
		expect(cleaned).toBe(true);
	});
});
