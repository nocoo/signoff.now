import { expect, test } from "bun:test";
import { WorkerHealth } from "./dev-worker-health";

test("startup tolerates failures, three consecutive failures restart, and success resets the count", () => {
	const health = new WorkerHealth(0);
	expect(health.check(15000, false)).toBe("wait");
	expect(health.check(30000, false)).toBe("wait");
	expect(health.check(45000, false)).toBe("wait");
	expect(health.check(60000, true)).toBe("wait");
	expect(health.check(75000, false)).toBe("wait");
	expect(health.check(90000, false)).toBe("wait");
	expect(health.check(105000, false)).toBe("restart");
});

test("sleep discards old failure counts, grants a recovery window, and does not replay missed checks", () => {
	const health = new WorkerHealth(0);
	health.check(30000, false);
	health.check(45000, false);
	expect(health.check(3600000, false)).toBe("wait");
	expect(health.check(3615000, false)).toBe("wait");
	expect(health.check(3630000, false)).toBe("wait");
	expect(health.check(3645000, false)).toBe("wait");
	expect(health.check(3660000, false)).toBe("restart");
});

test("clock corrections and a healthy wake never restart the Worker", () => {
	const health = new WorkerHealth(100000);
	health.check(130000, false);
	health.check(145000, false);
	expect(health.check(1000, false)).toBe("wait");
	expect(health.check(1000000, true)).toBe("wait");
	expect(health.check(1015000, true)).toBe("wait");
	expect(health.check(1030000, true)).toBe("wait");
});
