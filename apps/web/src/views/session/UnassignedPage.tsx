import type { Session } from "@signoff/domain/principal";
import { UserRoundX } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

export function UnassignedPage({ session }: { session: Session }) {
	return (
		<div className="flex min-h-svh items-center justify-center bg-basalt-background p-4">
			<EmptyState
				icon={UserRoundX}
				title="Waiting for access"
				description={`${session.email ?? session.principal ?? "This account"} is signed in but does not belong to a tenant yet. Ask a SignOff administrator to add you, then reload this page.`}
			/>
		</div>
	);
}
