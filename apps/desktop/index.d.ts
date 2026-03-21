/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly MAIN_VITE_PORT?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/** Type augmentation for electronTRPC global (injected by trpc-electron preload) */
interface ElectronTRPC {
	sendMessage: (...args: unknown[]) => void;
	onMessage: (...args: unknown[]) => () => void;
}

declare namespace globalThis {
	var electronTRPC: ElectronTRPC | undefined;
}
