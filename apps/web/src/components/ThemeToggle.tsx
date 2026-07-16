import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const dark = theme === "dark" || (theme === "system" && prefersDark);
	root.classList.toggle("dark", dark);
}

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => {
		const stored = localStorage.getItem("signoff-theme") as Theme | null;
		return stored ?? "system";
	});

	useEffect(() => {
		applyTheme(theme);
		localStorage.setItem("signoff-theme", theme);
	}, [theme]);

	const cycle = () => {
		setTheme((t) =>
			t === "system" ? "light" : t === "light" ? "dark" : "system",
		);
	};

	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={cycle}
			title={`Theme: ${theme}`}
		>
			{theme === "dark" ? (
				<Moon className="h-4 w-4" />
			) : (
				<Sun className="h-4 w-4" />
			)}
		</Button>
	);
}
