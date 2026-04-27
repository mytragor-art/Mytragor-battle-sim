import { defineConfig } from "vite";
import { resolve } from "path";

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
				index: resolve(__dirname, "index.html"),
				lobby: resolve(__dirname, "lobby.html"),
				game: resolve(__dirname, "game.html"),
				cardsLab: resolve(__dirname, "cards-lab.html"),
				manual: resolve(__dirname, "manual.html")
			}
		},
		sourcemap: true
	}
});

