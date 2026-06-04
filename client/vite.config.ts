import { defineConfig } from "vite";

export default defineConfig({
	root: ".",
	server: {
		host: true,
		port: 5173
	},
	preview: {
		host: true,
		port: 4173
	},
	build: {
		assetsDir: "static",
		rollupOptions: {
			input: {
				index: new URL("./index.html", import.meta.url).pathname,
				lobby: new URL("./lobby.html", import.meta.url).pathname,
				soloLobby: new URL("./solo-lobby.html", import.meta.url).pathname,
				game: new URL("./game.html", import.meta.url).pathname,
				manual: new URL("./manual.html", import.meta.url).pathname
			}
		},
		sourcemap: true
	}
});

