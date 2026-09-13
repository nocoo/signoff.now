import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useIsMobile } from "./use-mobile";

const originalWidth = window.innerWidth;

afterEach(() => {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: originalWidth,
	});
});

describe("useIsMobile", () => {
	it("resolves a mobile viewport on the first render", () => {
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 500,
		});
		const { result } = renderHook(() => useIsMobile());
		expect(result.current).toBe(true);
	});

	it("resolves a desktop viewport on the first render", () => {
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 1024,
		});
		const { result } = renderHook(() => useIsMobile());
		expect(result.current).toBe(false);
	});
});
