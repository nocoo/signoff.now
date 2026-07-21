/** Minimal structured logger (gitinfo/pulse style). */

export type Logger = {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
};

export type LoggerSinks = {
	log: (s: string) => void;
	error: (s: string) => void;
};

export function defaultSinks(): LoggerSinks {
	return {
		// CLI stdout/stderr is intentional
		// biome-ignore lint/suspicious/noConsole: CLI sink
		log: (s) => console.log(s),
		// biome-ignore lint/suspicious/noConsole: CLI sink
		error: (s) => console.error(s),
	};
}

export function createLogger(out: Partial<LoggerSinks> = {}): Logger {
	const sinks: LoggerSinks = {
		log: out.log ?? defaultSinks().log,
		error: out.error ?? defaultSinks().error,
	};
	return {
		info: (msg) => sinks.log(msg),
		warn: (msg) => sinks.log(`warn: ${msg}`),
		error: (msg) => sinks.error(`error: ${msg}`),
	};
}
