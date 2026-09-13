import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Match ThemeProvider's storage contract before the first React paint.
let stored: string | null = null;
try {
	stored = localStorage.getItem("signoff-theme");
} catch {
	// Continue with the system theme when storage is unavailable.
}
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark =
	stored === "dark" || ((stored === "system" || !stored) && prefersDark);
document.documentElement.classList.toggle("dark", isDark);
document.documentElement.classList.toggle("light", !isDark);
document.documentElement.dataset.mode = isDark ? "dark" : "light";

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element #root not found");
}
createRoot(rootElement).render(<App />);
