/**
 * PaneContent — renders the active tab's content inside a mosaic pane.
 *
 * Dispatches to the appropriate content component based on tab type.
 */

import { useCallback, useState } from "react";
import { trpc } from "../../lib/trpc";
import type { Tab } from "../../stores/tabs/types";
import { TabType } from "../../stores/tabs/types";
import { CodeEditor } from "../Editor/CodeEditor";

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

/** Editor tab content — loads file via tRPC and renders CodeMirror. */
function EditorContent({ tab }: { tab: Tab }) {
	const workspacePath = (tab.data?.workspacePath as string) ?? "";
	const filePath = (tab.data?.filePath as string) ?? "";

	const { data, isLoading, error } = trpc.filesystem.readFile.useQuery(
		{ workspacePath, relativePath: filePath },
		{ enabled: !!workspacePath && !!filePath },
	);

	const writeMutation = trpc.filesystem.writeFile.useMutation();

	const [localContent, setLocalContent] = useState<string | null>(null);

	const handleChange = useCallback((value: string) => {
		setLocalContent(value);
	}, []);

	const handleSave = useCallback(() => {
		if (localContent != null && workspacePath && filePath) {
			writeMutation.mutate({
				workspacePath,
				relativePath: filePath,
				content: localContent,
			});
		}
	}, [localContent, workspacePath, filePath, writeMutation]);

	// Register Cmd+S for save
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				handleSave();
			}
		},
		[handleSave],
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">Loading…</p>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="flex h-full items-center justify-center text-destructive">
				<p className="text-sm">{error?.message ?? "Failed to load file"}</p>
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: editor container needs keyboard events
		// biome-ignore lint/a11y/noStaticElementInteractions: Cmd+S save handler on editor wrapper
		<div className="h-full" onKeyDown={handleKeyDown} tabIndex={0}>
			<CodeEditor
				value={localContent ?? data.content}
				filename={tab.label}
				onChange={handleChange}
			/>
		</div>
	);
}

/** Diff tab content — shows git diff text. */
function DiffContent({ tab }: { tab: Tab }) {
	const workspacePath = (tab.data?.workspacePath as string) ?? "";
	const filePath = (tab.data?.filePath as string) ?? "";
	const staged = (tab.data?.staged as boolean) ?? false;

	const { data, isLoading, error } = trpc.changes.diff.useQuery(
		{ workspacePath, filePath, staged },
		{ enabled: !!workspacePath && !!filePath },
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">Loading diff…</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-full items-center justify-center text-destructive">
				<p className="text-sm">{error.message}</p>
			</div>
		);
	}

	if (!data?.diff) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				<p className="text-sm">No changes</p>
			</div>
		);
	}

	return (
		<CodeEditor value={data.diff} filename={`${filePath}.diff`} readOnly />
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
		case TabType.Editor:
			return <EditorContent tab={tab} />;
		case TabType.Diff:
			return <DiffContent tab={tab} />;
		default:
			return <PlaceholderContent tab={tab} />;
	}
}
