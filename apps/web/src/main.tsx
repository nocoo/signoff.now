import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Apply theme before render to avoid flash (Basalt pattern)
const stored = localStorage.getItem("signoff-theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark =
	stored === "dark" || ((stored === "system" || !stored) && prefersDark);
document.documentElement.classList.toggle("dark", isDark);

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element #root not found");
}
createRoot(rootElement).render(<App />);
