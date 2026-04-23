import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import dotenv from "dotenv";

process.on("uncaughtException", (err) => {
	console.error("[FATAL] uncaughtException:", err);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	console.error("[FATAL] unhandledRejection:", reason);
	process.exit(1);
});

import { LobbyRoom } from "./rooms/LobbyRoom";
import { MatchRoom } from "./rooms/MatchRoom";

dotenv.config();

const PORT = Number(process.env.PORT) || 2567;

function parseCorsOrigins(rawValue: string | undefined) {
	if (!rawValue) return true;
	const origins = rawValue
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return origins.length ? origins : true;
}

async function main() {
	const app = express();
	app.use(cors({ origin: parseCorsOrigins(process.env.CORS_ORIGIN) }));
	app.use(express.json());

	const httpServer = createServer(app);
	const gameServer = new Server({
		transport: new WebSocketTransport({ server: httpServer })
	});

	gameServer.define("lobby", LobbyRoom);
	gameServer.define("match", MatchRoom);

	app.get("/lobbies", async (_req, res) => {
		try {
			const rooms = await matchMaker.query({ name: "lobby" });
			const openRooms = rooms
				.filter((r: any) => !r.locked)
				.map((r: any) => ({
					roomId: r.roomId,
					clients: Number(r.clients || 0),
					maxClients: Number(r.maxClients || 2),
					locked: !!r.locked,
					metadata: {
						title: String(r.metadata?.title || ""),
						deckName: String(r.metadata?.deckName || ""),
						leaderId: String(r.metadata?.leaderId || "")
					}
				}));

			res.json({ rooms: openRooms });
		} catch (error) {
			console.error("[SERVER] Failed to list lobbies", error);
			res.status(500).json({ rooms: [], error: "failed_to_list_lobbies" });
		}
	});

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", port: PORT, env: process.env.NODE_ENV });
	});

	console.log(`[SERVER] Starting on PORT=${PORT}, binding 0.0.0.0`);
	await gameServer.listen(PORT, "0.0.0.0");
	console.log(`[SERVER] Ready on port ${PORT}`);
}

main().catch((err) => {
	console.error("[SERVER] Fatal error", err);
	process.exit(1);
});

