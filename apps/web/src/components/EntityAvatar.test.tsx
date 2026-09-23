import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AvatarSourceContext, EntityAvatar, EntityLabel } from "./EntityAvatar";

vi.mock("@nocoo/basalt", () => ({
	Avatar: (props: ComponentProps<"span">) => <span {...props} />,
	AvatarImage: ({
		onLoadingStatusChange,
		...props
	}: ComponentProps<"img"> & {
		onLoadingStatusChange: (status: "error" | "loaded") => void;
	}) => (
		<img
			{...props}
			alt=""
			onError={() => onLoadingStatusChange("error")}
			onLoad={() => onLoadingStatusChange("loaded")}
		/>
	),
	AvatarFallback: (props: ComponentProps<"span">) => <span {...props} />,
}));
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("uses cached images for the current source and never emits a remote img URL", () => {
	const original = "https://dev.azure.com/org/avatar";
	const { container, rerender } = render(
		<AvatarSourceContext.Provider value="cli">
			<EntityAvatar name="Ada Lovelace" avatarUrl={original} />
		</AvatarSourceContext.Provider>,
	);
	const request = () =>
		new URL(
			container.querySelector("img")?.getAttribute("src") ?? "",
			"https://signoff.dev.hexly.ai",
		);
	expect(request().pathname).toBe("/api/avatars");
	expect(request().searchParams.get("source")).toBe("live");
	expect(request().searchParams.get("url")).toBe(original);
	rerender(
		<AvatarSourceContext.Provider value="demo">
			<EntityAvatar name="Ada Lovelace" avatarUrl={original} />
		</AvatarSourceContext.Provider>,
	);
	expect(request().searchParams.get("source")).toBe("sample");
});

it("lets a known entity source override the page source and retains label and initials", () => {
	const { container } = render(
		<AvatarSourceContext.Provider value="demo">
			<EntityLabel
				name="Ada Lovelace"
				secondary="Required reviewer"
				avatarUrl="https://example.com/ada.png"
				source="cli"
			/>
		</AvatarSourceContext.Provider>,
	);
	expect(container.querySelector("img")?.getAttribute("src")).toContain(
		"source=live",
	);
	expect(screen.getByText("Ada Lovelace")).toBeTruthy();
	expect(screen.getByText("Required reviewer")).toBeTruthy();
	expect(screen.getByText("AL")).toBeTruthy();
});

it("keeps initials without an image request when no usable photo exists", () => {
	const { container } = render(
		<EntityAvatar name="Ada Lovelace" avatarUrl="javascript:alert(1)" />,
	);
	expect(container.querySelector("img")).toBeNull();
	expect(screen.getByText("AL")).toBeTruthy();
});

it("retries only missing cached photos and stops after the background cache is filled", async () => {
	vi.useFakeTimers();
	const { container } = render(
		<EntityAvatar
			name="Ada Lovelace"
			avatarUrl="https://example.com/ada.png"
		/>,
	);
	const first = container.querySelector("img") as HTMLImageElement;
	fireEvent.error(first);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(59_999);
	});
	expect(container.querySelector("img")).toBe(first);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	const retried = container.querySelector("img") as HTMLImageElement;
	expect(retried).not.toBe(first);
	expect(retried.getAttribute("src")).toBe(first.getAttribute("src"));
	fireEvent.load(retried);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(120_000);
	});
	expect(container.querySelector("img")).toBe(retried);
});

it("suspends missing-photo retries while hidden and retries when the page becomes visible", async () => {
	vi.useFakeTimers();
	let visibility = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(
		() => visibility as DocumentVisibilityState,
	);
	const { container } = render(
		<EntityAvatar
			name="Ada Lovelace"
			avatarUrl="https://example.com/ada.png"
		/>,
	);
	const first = container.querySelector("img") as HTMLImageElement;
	fireEvent.error(first);
	visibility = "hidden";
	fireEvent(document, new Event("visibilitychange"));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60_000);
	});
	expect(container.querySelector("img")).toBe(first);
	visibility = "visible";
	fireEvent(document, new Event("visibilitychange"));
	expect(container.querySelector("img")).not.toBe(first);
});
