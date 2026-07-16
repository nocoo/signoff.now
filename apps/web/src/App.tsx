/**
 * Hello-world shell using Basalt 3-tier luminance hierarchy:
 * L0 body → L1 content panel → L2 inner card.
 */
export default function App() {
	return (
		<div className="flex min-h-svh items-center justify-center bg-background p-6">
			<main className="w-full max-w-lg rounded-[var(--radius-card)] bg-card p-8 shadow-sm">
				<div className="rounded-[var(--radius-widget)] bg-secondary p-6">
					<p className="font-display text-sm font-semibold tracking-wide text-primary">
						signoff.now
					</p>
					<h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-foreground">
						Hello, world
					</h1>
					<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
						Vite + React + TypeScript frontend scaffold. Design tokens inherited
						from the Basalt template (3-tier luminance). Product requirements
						TBD.
					</p>
					<p className="mt-6 text-xs text-muted-foreground">
						v{__APP_VERSION__}
					</p>
				</div>
			</main>
		</div>
	);
}
