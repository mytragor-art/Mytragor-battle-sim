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
import { SpectatorRoom } from "./rooms/SpectatorRoom";

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
	gameServer.define("spectator", SpectatorRoom);

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

	app.get("/matches", async (_req, res) => {
		try {
			const [matches, spectators] = await Promise.all([
				matchMaker.query({ name: "match" }),
				matchMaker.query({ name: "spectator" })
			]);
			const spectatorByMatchRoomId = new Map<string, any>();
			for (const room of spectators) {
				const matchRoomId = String(room.metadata?.matchRoomId || "");
				if (matchRoomId) spectatorByMatchRoomId.set(matchRoomId, room);
			}
			const activeMatches = matches.map((room: any) => ({
				roomId: String(room.roomId || ""),
				spectatorRoomId: String(spectatorByMatchRoomId.get(String(room.roomId || ""))?.roomId || ""),
				clients: Number(room.clients || 0),
				maxClients: Number(room.maxClients || 2),
				locked: !!room.locked,
				metadata: {
					title: String(room.metadata?.title || ""),
					p1Name: String(room.metadata?.p1Name || ""),
					p2Name: String(room.metadata?.p2Name || ""),
					p1LeaderId: String(room.metadata?.p1LeaderId || ""),
					p2LeaderId: String(room.metadata?.p2LeaderId || "")
				}
			}));
			res.json({ rooms: activeMatches });
		} catch (error) {
			console.error("[SERVER] Failed to list matches", error);
			res.status(500).json({ rooms: [], error: "failed_to_list_matches" });
		}
	});

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", port: PORT, env: process.env.NODE_ENV });
	});

	app.get("/matches/:matchRoomId/spectator", async (req, res) => {
		try {
			const targetMatchRoomId = String(req.params.matchRoomId || "").trim();
			if (!targetMatchRoomId) {
				res.status(400).json({ error: "missing_match_room_id" });
				return;
			}
			const rooms = await matchMaker.query({ name: "spectator" });
			const room = rooms.find((item: any) => String(item.metadata?.matchRoomId || "") === targetMatchRoomId);
			if (!room) {
				res.status(404).json({ error: "spectator_room_not_found" });
				return;
			}
			res.json({ matchRoomId: targetMatchRoomId, spectatorRoomId: String(room.roomId || "") });
		} catch (error) {
			console.error("[SERVER] Failed to resolve spectator room", error);
			res.status(500).json({ error: "failed_to_resolve_spectator_room" });
		}
	});

	console.log(`[SERVER] Starting on PORT=${PORT}, binding 0.0.0.0`);
	await gameServer.listen(PORT, "0.0.0.0");
	console.log(`[SERVER] Ready on port ${PORT}`);
}

main().catch((err) => {
	console.error("[SERVER] Fatal error", err);
	process.exit(1);
});

