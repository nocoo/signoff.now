/**
 * Application menu builder.
 *
 * Creates the native menu bar with standard roles.
 * Designed to be called once at startup.
 */

import { Menu, type MenuItemConstructorOptions } from "electron";

/** Builds and sets the application menu. Returns the Menu instance. */
export function buildApplicationMenu(): Menu {
	const template: MenuItemConstructorOptions[] = [
		{ role: "appMenu" },
		{ role: "fileMenu" },
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	];

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
	return menu;
}
