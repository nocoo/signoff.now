import type { Session } from "@signoff/domain/principal";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { storeTenant } from "@/lib/api";
import { loadSession } from "@/models/sessionApi";

export type SessionState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; session: Session };

type SessionContextValue = {
	state: SessionState;
	reload: () => Promise<void>;
	switchTenant: (id: string) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionState(
	reloadPage: () => void = () => window.location.reload(),
): SessionContextValue {
	const [state, setState] = useState<SessionState>({ status: "loading" });
	const reload = useCallback(async () => {
		try {
			setState({ status: "ready", session: await loadSession() });
		} catch (error) {
			setState({
				status: "error",
				message:
					error instanceof Error
						? error.message
						: "Could not load your session",
			});
		}
	}, []);
	useEffect(() => {
		void reload();
	}, [reload]);
	const switchTenant = useCallback(
		(id: string) => {
			storeTenant(id);
			// Every cached query belongs to one tenant; reload rather than rekey.
			reloadPage();
		},
		[reloadPage],
	);
	return { state, reload, switchTenant };
}

export function SessionProvider({ children }: { children: ReactNode }) {
	const value = useSessionState();
	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

export function useSession(): SessionContextValue {
	const session = useContext(SessionContext);
	if (!session) throw new Error("SessionProvider is required");
	return session;
}
