import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

export function PullDescription({
	description,
	sourceUrl,
}: {
	description: string;
	sourceUrl: string;
}) {
	return (
		<div className="pull-markdown min-w-0 break-words text-sm leading-6 text-basalt-muted-foreground">
			<Markdown
				remarkPlugins={[remarkGfm]}
				skipHtml
				urlTransform={(url) => {
					const safe = defaultUrlTransform(url);
					if (!safe) return;
					try {
						return new URL(safe, sourceUrl).href;
					} catch {
						return;
					}
				}}
				components={{
					a: ({ href, children }) =>
						href ? (
							<a href={href} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						) : (
							<span>{children}</span>
						),
					img: ({ src, alt }) =>
						src ? (
							<img src={src} alt={alt ?? ""} loading="lazy" />
						) : (
							<span>{alt}</span>
						),
					table: ({ children }) => (
						<div className="overflow-x-auto">
							<Table className="border-collapse text-xs">{children}</Table>
						</div>
					),
					thead: ({ children }) => <TableHeader>{children}</TableHeader>,
					tbody: ({ children }) => <TableBody>{children}</TableBody>,
					tr: ({ children }) => <TableRow>{children}</TableRow>,
					th: ({ children, style }) => (
						<TableHead
							style={style}
							className="border border-basalt-border px-3 py-2 font-semibold text-basalt-foreground"
						>
							{children}
						</TableHead>
					),
					td: ({ children, style }) => (
						<TableCell
							style={style}
							className="border border-basalt-border px-3 py-2"
						>
							{children}
						</TableCell>
					),
				}}
			>
				{description.trim() ? description : "No description provided."}
			</Markdown>
		</div>
	);
}
