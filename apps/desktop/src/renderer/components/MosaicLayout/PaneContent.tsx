/**
 * PaneContent — renders the active tab's content inside a mosaic pane.
 *
 * Dispatches to the appropriate content component based on tab type.
 * Phase 3 scaffold: all tab types render placeholder content.
 */

import type { Tab } from "../../stores/tabs/types";
import { TabType } from "../../stores/tabs/types";

function WelcomeContent() {
	return (
		<div className="flex h-full items-center justify-center text-muted-foreground">
			<p className="text-sm">Welcome to Signoff</p>
		</div>
	);
}

function PlaceholderContent({ tab }: { tab: Tab }) {
	return (
		<div className="flex h-full items-center justify-center text-muted-foreground">
			<p className="text-sm">
				{tab.type} — {tab.label}
			</p>
		</div>
	);
}

export function PaneContent({ tab }: { tab: Tab | undefined }) {
	if (!tab) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">No active tab</p>
			</div>
		);
	}

	switch (tab.type) {
		case TabType.Welcome:
			return <WelcomeContent />;
		default:
			return <PlaceholderContent tab={tab} />;
	}
}
