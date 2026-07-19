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
				index: "index.html",
				lobby: "lobby.html",
				soloLobby: "solo-lobby.html",
				game: "game.html",
				manual: "manual.html"
			}
		},
		sourcemap: true
	}
});

