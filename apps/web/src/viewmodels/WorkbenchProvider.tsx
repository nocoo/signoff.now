import { createContext, type ReactNode, useContext } from "react";
import {
	useWorkbenchViewModel,
	type WorkbenchViewModel,
} from "./useWorkbenchViewModel";

const WorkbenchContext = createContext<WorkbenchViewModel | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
	const workbench = useWorkbenchViewModel();
	return (
		<WorkbenchContext.Provider value={workbench}>
			{children}
		</WorkbenchContext.Provider>
	);
}

export function useWorkbench(): WorkbenchViewModel {
	const workbench = useContext(WorkbenchContext);
	if (!workbench) throw new Error("WorkbenchProvider is required");
	return workbench;
}
