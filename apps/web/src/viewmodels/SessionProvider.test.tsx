import {
	act,
	cleanup,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	SessionProvider,
	useSession,
	useSessionState,
} from "./SessionProvider";

const session = {
	authenticated: true,
	local: false,
	principal: "email:a@x.io",
	email: "a@x.io",
	name: "Ada",
	service: false,
	admin: false,
	tenants: [
		{ id: "default", name: "Default" },
		{ id: "b", name: "B" },
	],
	tenantId: "default",
};
let reply: () => Response | Promise<Response>;
beforeEach(() => {
	localStorage.clear();
	reply = () => Response.json(session);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => reply()),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("loads the session and switches tenant by reloading", async () => {
	const reloadPage = vi.fn();
	const { result } = renderHook(() => useSessionState(reloadPage));
	expect(result.current.state).toEqual({ status: "loading" });
	await waitFor(() =>
		expect(result.current.state).toEqual({ status: "ready", session }),
	);
	act(() => result.current.switchTenant("b"));
	expect(localStorage.getItem("signoff-tenant")).toBe("b");
	expect(reloadPage).toHaveBeenCalledOnce();
});

it("reports load failures and recovers on reload", async () => {
	reply = () => Response.json({ error: "Invalid Access JWT" }, { status: 403 });
	const { result } = renderHook(() => useSessionState(vi.fn()));
	await waitFor(() =>
		expect(result.current.state).toEqual({
			status: "error",
			message: "Invalid Access JWT",
		}),
	);
	reply = () => Promise.reject("offline");
	await act(() => result.current.reload());
	expect(result.current.state).toEqual({
		status: "error",
		message: "Could not load your session",
	});
	reply = () => Response.json(session);
	await act(() => result.current.reload());
	expect(result.current.state.status).toBe("ready");
});

it("provides the session through context and requires the provider", async () => {
	function Probe() {
		const { state } = useSession();
		return <p>{state.status}</p>;
	}
	render(
		<SessionProvider>
			<Probe />
		</SessionProvider>,
	);
	expect(await screen.findByText("ready")).toBeTruthy();
	expect(() => renderHook(() => useSession())).toThrow(
		"SessionProvider is required",
	);
});
