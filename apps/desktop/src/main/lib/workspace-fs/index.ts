import {
	createFsHostService,
	type FsHostService,
} from "@signoff/workspace-fs/host";

const instances = new Map<string, FsHostService>();

/** Per-workspace FsHostService, lazily created and cached. */
export function getFsHostService(rootPath: string): FsHostService {
	let fs = instances.get(rootPath);
	if (!fs) {
		fs = createFsHostService({ rootPath });
		instances.set(rootPath, fs);
	}
	return fs;
}

export async function closeAllFsHostServices(): Promise<void> {
	for (const fs of instances.values()) {
		await fs.close();
	}
	instances.clear();
}
