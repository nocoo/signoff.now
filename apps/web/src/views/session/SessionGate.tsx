import { Button } from "@nocoo/basalt";
import { canUseWorkspace } from "@signoff/domain/principal";
import { CloudOff } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useSession } from "@/viewmodels/SessionProvider";
import { UnassignedPage } from "./UnassignedPage";

/** Workspace data loads only after the session allows it. */
export function SessionGate({ children }: { children: ReactNode }) {
	const { state, reload } = useSession();
	if (state.status === "loading")
		return (
			<p role="status" className="sr-only">
				Loading your session…
			</p>
		);
	if (state.status === "error")
		return (
			<div className="flex min-h-svh items-center justify-center bg-basalt-background p-4">
				<EmptyState
					icon={CloudOff}
					title="SignOff is unavailable"
					description={state.message}
					action={
						<Button variant="outline" onClick={() => void reload()}>
							Retry
						</Button>
					}
				/>
			</div>
		);
	if (!canUseWorkspace(state.session))
		return <UnassignedPage session={state.session} />;
	return children;
}
