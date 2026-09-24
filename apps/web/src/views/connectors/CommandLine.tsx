import { Button } from "@nocoo/basalt";
import { CodeBlock } from "@nocoo/basalt/components/code";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** One terminal command with a copy button. */
export function CommandLine({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard access can be denied; the command stays selectable.
		}
	};
	return (
		<div className="flex items-stretch gap-2">
			<CodeBlock className="m-0 min-w-0 flex-1 overflow-x-auto py-2 text-xs">
				{command}
			</CodeBlock>
			<Button
				variant="outline"
				size="icon"
				className="h-auto shrink-0"
				onClick={() => void copy()}
				aria-label={copied ? "Copied" : `Copy ${command}`}
			>
				{copied ? (
					<Check className="h-4 w-4" aria-hidden strokeWidth={1.5} />
				) : (
					<Copy className="h-4 w-4" aria-hidden strokeWidth={1.5} />
				)}
			</Button>
		</div>
	);
}
