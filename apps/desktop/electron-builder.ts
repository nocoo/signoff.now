import type { Configuration } from "electron-builder";

const config: Configuration = {
	appId: "com.signoff.desktop",
	productName: "Signoff",
	protocols: [
		{
			name: "Signoff",
			schemes: ["signoff"],
		},
	],
	directories: {
		output: `release/\${version}`,
		buildResources: "src/resources/build",
	},
	files: ["dist/**/*"],
	extraResources: ["src/resources/public/**/*"],

	mac: {
		category: "public.app-category.developer-tools",
		icon: "src/resources/build/icons/icon.icns",
		entitlements: "src/resources/build/entitlements.mac.plist",
		entitlementsInherit: "src/resources/build/entitlements.mac.inherit.plist",
		hardenedRuntime: true,
		gatekeeperAssess: false,
		target: [{ target: "dmg", arch: ["arm64", "x64"] }],
	},

	win: {
		icon: "src/resources/build/icons/icon.png",
		target: [{ target: "nsis", arch: ["x64"] }],
	},

	linux: {
		icon: "src/resources/build/icons/icon.png",
		target: [{ target: "AppImage", arch: ["x64"] }],
		category: "Development",
	},

	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true,
	},

	publish: {
		provider: "generic",
		url: "https://releases.signoff.now",
	},
};

export default config;
