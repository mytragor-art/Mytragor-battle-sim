import { defineConfig } from "vite";

const backendProxy = {
	target: "http://localhost:2567",
	changeOrigin: true,
	ws: true,
	rewrite: (path: string) => path.replace(/^\/colyseus/, "")
};

export default defineConfig({
	root: ".",
	server: {
		host: true,
		port: 5173,
		proxy: {
			"/colyseus": backendProxy
		}
	},
	preview: {
		host: true,
		port: 4173,
		proxy: {
			"/colyseus": backendProxy
		}
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

