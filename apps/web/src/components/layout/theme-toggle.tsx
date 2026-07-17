import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "signoff-theme";

function getSystemTheme(): "light" | "dark" {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

const ICON_PROPS = {
	className: "h-4 w-4",
	"aria-hidden": true as const,
	strokeWidth: 1.5,
};

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => {
		return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
	});

	useEffect(() => {
		const root = document.documentElement;
		const applied = theme === "system" ? getSystemTheme() : theme;
		root.classList.toggle("dark", applied === "dark");
		localStorage.setItem(STORAGE_KEY, theme);

		if (theme === "system") {
			const mq = window.matchMedia("(prefers-color-scheme: dark)");
			const handler = (e: MediaQueryListEvent) => {
				root.classList.toggle("dark", e.matches);
			};
			mq.addEventListener("change", handler);
			return () => mq.removeEventListener("change", handler);
		}
	}, [theme]);

	const cycleTheme = () => {
		setTheme((prev) => {
			if (prev === "system") return "light";
			if (prev === "light") return "dark";
			return "system";
		});
	};

	return (
		<button
			type="button"
			onClick={cycleTheme}
			className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
			aria-label={`Theme: ${theme}. Click to cycle.`}
			title={`Theme: ${theme}`}
		>
			{theme === "system" ? (
				<Monitor {...ICON_PROPS} />
			) : theme === "dark" ? (
				<Moon {...ICON_PROPS} />
			) : (
				<Sun {...ICON_PROPS} />
			)}
		</button>
	);
}
