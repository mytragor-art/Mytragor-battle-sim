import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const htmlEntry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

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
				index: htmlEntry("./index.html"),
				lobby: htmlEntry("./lobby.html"),
				soloLobby: htmlEntry("./solo-lobby.html"),
				game: htmlEntry("./game.html"),
				manual: htmlEntry("./manual.html")
			}
		},
		sourcemap: true
	}
});

