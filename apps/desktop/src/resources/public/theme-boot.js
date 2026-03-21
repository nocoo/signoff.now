/**
 * Prevents theme flash (FOUC) by reading the saved theme from localStorage
 * and applying it to the document root before React hydrates.
 *
 * This script is loaded synchronously in the HTML <head>.
 */
(() => {
	var THEME_KEY = "signoff-theme";
	var theme = "dark";
	var saved = null;
	try {
		saved = localStorage.getItem(THEME_KEY);
		if (saved === "light" || saved === "dark" || saved === "system") {
			if (saved === "system") {
				theme = window.matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light";
			} else {
				theme = saved;
			}
		}
	} catch (_e) {
		// localStorage may be unavailable
	}
	document.documentElement.classList.add(theme);
	document.documentElement.style.colorScheme = theme;
})();
