/**
 * CodeEditor — React wrapper around CodeMirror 6.
 *
 * Features:
 * - Automatic language detection from filename
 * - One-dark theme
 * - Basic keybindings (default + search)
 * - Read-only mode support
 * - onChange callback for content updates
 *
 * Uses useRef + useEffect to mount CodeMirror outside React's virtual DOM.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { loadLanguage } from "./language-loader";
import { detectLanguage } from "./languages";

export interface CodeEditorProps {
	/** File content to display. */
	value: string;
	/** Filename for language detection. */
	filename: string;
	/** Called when the editor content changes. */
	onChange?: (value: string) => void;
	/** If true, the editor is read-only. */
	readOnly?: boolean;
	/** Additional CSS class for the container. */
	className?: string;
}

export function CodeEditor({
	value,
	filename,
	onChange,
	readOnly = false,
	className = "",
}: CodeEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const langCompartment = useRef(new Compartment());

	// Mount/unmount the editor
	useEffect(() => {
		if (!containerRef.current) return;

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged && onChange) {
				onChange(update.state.doc.toString());
			}
		});

		const state = EditorState.create({
			doc: value,
			extensions: [
				lineNumbers(),
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
				oneDark,
				updateListener,
				EditorState.readOnly.of(readOnly),
				EditorView.theme({
					"&": { height: "100%" },
					".cm-scroller": { overflow: "auto" },
				}),
				langCompartment.current.of([]),
			],
		});

		const view = new EditorView({
			state,
			parent: containerRef.current,
		});

		viewRef.current = view;

		// Async: load and apply language support
		const langId = detectLanguage(filename);
		if (langId) {
			loadLanguage(langId).then((langSupport) => {
				if (langSupport && viewRef.current) {
					viewRef.current.dispatch({
						effects: langCompartment.current.reconfigure(langSupport),
					});
				}
			});
		}

		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// Intentionally depend only on mount-time props
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filename, readOnly, onChange, value]);

	// Update content when value changes externally
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const currentValue = view.state.doc.toString();
		if (currentValue !== value) {
			view.dispatch({
				changes: { from: 0, to: currentValue.length, insert: value },
			});
		}
	}, [value]);

	return (
		<div
			ref={containerRef}
			className={`h-full overflow-hidden ${className}`}
			data-testid="code-editor"
		/>
	);
}
