import { stripVTControlCharacters, styleText } from "node:util";
import type { Logger } from "./logger";

const colors = {
	HEARTBEAT: "gray",
	HEALTH: "gray",
	CLAIM: "blueBright",
	SCHEDULE: "magenta",
	AI: "magentaBright",
	AVATAR: "cyan",
	NETWORK: "gray",
	CACHE: "cyanBright",
	WRITE: "yellow",
	TASK: "green",
	CHECKS: "blueBright",
	DISCOVER: "magentaBright",
	COLLECTOR: "cyan",
	API: "cyan",
} as const;

export type LogCategory = keyof typeof colors;

export function runtimeLog(
	category: LogCategory,
	message: string,
	options: {
		level?: "info" | "warn" | "error";
		color?: boolean;
		time?: Date;
	} = {},
): string {
	const color =
		options.color ??
		(process.env.NO_COLOR === undefined &&
			process.env.FORCE_COLOR !== "0" &&
			(process.env.FORCE_COLOR !== undefined || !!process.stderr.isTTY));
	const paint = (style: Parameters<typeof styleText>[0], text: string) =>
		color ? styleText(style, text, { validateStream: false }) : text;
	const level = options.level ?? "info";
	const tone =
		level === "error"
			? "redBright"
			: level === "warn"
				? "yellow"
				: colors[category];
	const timestamp = (options.time ?? new Date()).toTimeString().slice(0, 8);
	const detail = stripVTControlCharacters(message).replace(/[\r\n]/g, " ");
	const messageTone =
		level === "info" && /\bcomplete \d+ms$/.test(detail) ? "greenBright" : tone;
	return `${paint("gray", timestamp)} ${paint(["bold", tone], category.padEnd(10))} ${paint(level === "info" ? messageTone : ["bold", tone], level === "info" ? detail : `${level.toUpperCase()} ${detail}`)}`;
}

export function createRuntimeLogger(): Logger {
	const write = (level: "info" | "warn" | "error", message: string) => {
		const match = /^\[(checks|discover|avatars|ai)\] /i.exec(message);
		const tag = match?.[1]?.toUpperCase();
		const category =
			tag === "AVATARS" ? "AVATAR" : ((tag ?? "COLLECTOR") as LogCategory);
		process.stderr.write(
			`${runtimeLog(category, match ? message.slice(match[0].length) : message, { level })}\n`,
		);
	};
	return {
		info: (message) => write("info", message),
		warn: (message) => write("warn", message),
		error: (message) => write("error", message),
	};
}
