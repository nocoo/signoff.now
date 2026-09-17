import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewportCollection } from "./useViewportCollection";

let notify: IntersectionObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: IntersectionObserverCallback) {
				notify = callback;
			}
			observe = observe;
			disconnect = disconnect;
		},
	);
});
afterEach(() => {
	cleanup();
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	observe.mockClear();
	disconnect.mockClear();
});

it("requests only intersecting rows and stops after the PR page unmounts", () => {
	const table = document.createElement("div");
	table.innerHTML =
		'<div data-pull-id="one"></div><div data-pull-id="two"></div><div data-pull-id="next-page"></div>';
	document.body.append(table);
	const collect = vi.fn();
	const hook = renderHook(() =>
		useViewportCollection({ current: table }, ["one", "two"], collect, true),
	);
	expect(observe).toHaveBeenCalledTimes(2);
	act(() =>
		notify(
			[
				{
					target: table.children[0],
					isIntersecting: true,
					intersectionRatio: 0.5,
				},
				{
					target: table.children[1],
					isIntersecting: false,
					intersectionRatio: 0,
				},
			] as IntersectionObserverEntry[],
			{} as IntersectionObserver,
		),
	);
	act(() => vi.advanceTimersByTime(600));
	expect(collect).toHaveBeenLastCalledWith(["one"]);
	act(() =>
		notify(
			[
				{
					target: table.children[0],
					isIntersecting: false,
					intersectionRatio: 0,
				},
				{
					target: table.children[1],
					isIntersecting: true,
					intersectionRatio: 1,
				},
			] as IntersectionObserverEntry[],
			{} as IntersectionObserver,
		),
	);
	act(() => vi.advanceTimersByTime(600));
	expect(collect).toHaveBeenLastCalledWith(["two"]);
	hook.unmount();
	const calls = collect.mock.calls.length;
	act(() => vi.advanceTimersByTime(30_000));
	expect(collect).toHaveBeenCalledTimes(calls);
	expect(disconnect).toHaveBeenCalledOnce();
});

it("pauses collection in a hidden tab and prioritizes an open PR detail", () => {
	const collect = vi.fn();
	const { rerender } = renderHook(
		({ enabled }) =>
			useViewportCollection(
				{ current: null },
				[],
				collect,
				enabled,
				"detail-pr",
			),
		{ initialProps: { enabled: true } },
	);
	act(() => vi.advanceTimersByTime(600));
	expect(collect).toHaveBeenLastCalledWith(["detail-pr"]);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	collect.mockClear();
	act(() => vi.advanceTimersByTime(5000));
	expect(collect).not.toHaveBeenCalled();
	rerender({ enabled: false });
	act(() => vi.advanceTimersByTime(5000));
	expect(collect).not.toHaveBeenCalled();
});
