import { describe, expect, test } from "bun:test";
import { settingsPutCasOutcome } from "./settings-cas.js";

describe("settingsPutCasOutcome", () => {
	test("only changes===1 is ok", () => {
		expect(settingsPutCasOutcome(1)).toBe("ok");
		expect(settingsPutCasOutcome(0)).toBe("conflict");
		expect(settingsPutCasOutcome(2)).toBe("conflict");
	});
});
