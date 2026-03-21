import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: WelcomePage,
});

function WelcomePage() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="text-center">
				<h1 className="text-4xl font-bold tracking-tight">Signoff</h1>
				<p className="mt-4 text-lg text-muted-foreground">
					Welcome to Signoff Desktop
				</p>
				<p className="mt-2 text-sm text-muted-foreground">
					Phase 3 scaffold — ready for development
				</p>
			</div>
		</div>
	);
}
