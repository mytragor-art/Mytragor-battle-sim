import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import dotenv from "dotenv";

process.on("uncaughtException", (err) => {
	console.error("[FATAL] uncaughtException:", err && (err.stack || err));
	// Do not call process.exit here to avoid abruptly terminating the server
	// and dropping all active rooms. Let a process manager handle restarts.
});
process.on("unhandledRejection", (reason) => {
	console.error("[FATAL] unhandledRejection:", reason);
	// Do not exit; log for diagnosis. Consider using a process manager
	// (pm2/systemd) to restart on failures if desired.
});

import { LobbyRoom } from "./rooms/LobbyRoom";
import { MatchRoom } from "./rooms/MatchRoom";
import { SoloLobbyRoom } from "./rooms/SoloLobbyRoom";
import { SoloMatchRoom } from "./rooms/SoloMatchRoom";
import { SpectatorRoom } from "./rooms/SpectatorRoom";
import { recordClientDiagnostic } from "./utils/clientDiagnostics";

dotenv.config();

const PORT = Number(process.env.PORT) || 2567;
const WEBSOCKET_PING_INTERVAL_MS = 10_000;
const WEBSOCKET_PING_MAX_RETRIES = 3;

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
		transport: new WebSocketTransport({
			server: httpServer,
			pingInterval: WEBSOCKET_PING_INTERVAL_MS,
			pingMaxRetries: WEBSOCKET_PING_MAX_RETRIES
		})
	});

	gameServer.define("lobby", LobbyRoom).filterBy(["queue"]);
	gameServer.define("private_lobby", LobbyRoom).filterBy(["queue", "privateCode"]);
	gameServer.define("match", MatchRoom);
	gameServer.define("solo_lobby", SoloLobbyRoom);
	gameServer.define("solo_match", SoloMatchRoom);
	gameServer.define("spectator", SpectatorRoom);

	app.get("/lobbies", async (_req, res) => {
		try {
			const rooms = await matchMaker.query({ name: "lobby" });
			const openRooms = rooms
				.filter((r: any) => !r.locked && String(r.metadata?.queue || "public") === "public")
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

	app.get("/private-lobbies/:code", async (req, res) => {
		try {
			const code = String(req.params.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
			if (!code) {
				res.status(400).json({ exists: false, error: "missing_private_code" });
				return;
			}
			const rooms = await matchMaker.query({ name: "private_lobby" });
			const room = rooms.find((item: any) => !item.locked && String(item.metadata?.privateCode || "") === code);
			res.json({ exists: !!room, roomId: room ? String(room.roomId || "") : "" });
		} catch (error) {
			console.error("[SERVER] Failed to resolve private lobby", error);
			res.status(500).json({ exists: false, error: "failed_to_resolve_private_lobby" });
		}
	});

	app.get("/matches", async (_req, res) => {
		try {
			const [matches, soloMatches, spectators] = await Promise.all([
				matchMaker.query({ name: "match" }),
				matchMaker.query({ name: "solo_match" }),
				matchMaker.query({ name: "spectator" })
			]);
			const spectatorByMatchRoomId = new Map<string, any>();
			for (const room of spectators) {
				const matchRoomId = String(room.metadata?.matchRoomId || "");
				if (matchRoomId) spectatorByMatchRoomId.set(matchRoomId, room);
			}
			const activeMatches = [...matches, ...soloMatches]
				.filter((room: any) => Number(room.clients || 0) > 0)
				.map((room: any) => ({
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

	app.get("/solo-lobbies", async (_req, res) => {
		try {
			const rooms = await matchMaker.query({ name: "solo_lobby" });
			const openRooms = rooms
				.filter((room: any) => !room.locked)
				.map((room: any) => ({
					roomId: String(room.roomId || ""),
					clients: Number(room.clients || 0),
					maxClients: Number(room.maxClients || 1),
					locked: !!room.locked,
					metadata: {
						title: String(room.metadata?.title || ""),
						deckName: String(room.metadata?.deckName || ""),
						leaderId: String(room.metadata?.leaderId || ""),
						botName: String(room.metadata?.botName || "IA"),
						botLeaderId: String(room.metadata?.botLeaderId || "")
					}
				}));

			res.json({ rooms: openRooms });
		} catch (error) {
			console.error("[SERVER] Failed to list solo lobbies", error);
			res.status(500).json({ rooms: [], error: "failed_to_list_solo_lobbies" });
		}
	});

	app.get("/solo-matches", async (_req, res) => {
		try {
			const spectators = await matchMaker.query({ name: "spectator" });
			const spectatorByMatchRoomId = new Map<string, any>();
			for (const room of spectators) {
				const matchRoomId = String(room.metadata?.matchRoomId || "");
				if (matchRoomId) spectatorByMatchRoomId.set(matchRoomId, room);
			}
			const matches = await matchMaker.query({ name: "solo_match" });
			const activeMatches = matches.map((room: any) => ({
				roomId: String(room.roomId || ""),
				spectatorRoomId: String(spectatorByMatchRoomId.get(String(room.roomId || ""))?.roomId || ""),
				clients: Number(room.clients || 0),
				maxClients: Number(room.maxClients || 1),
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
			console.error("[SERVER] Failed to list solo matches", error);
			res.status(500).json({ rooms: [], error: "failed_to_list_solo_matches" });
		}
	});

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", port: PORT, env: process.env.NODE_ENV });
	});

	app.post("/client-diagnostics", (req, res) => {
		const diagnostic = recordClientDiagnostic(req.body || {});
		if (!diagnostic) {
			res.status(400).json({ error: "missing_room_or_session" });
			return;
		}
		if (diagnostic.event !== "heartbeat") {
			console.log(`[CLIENT DIAG] room=${diagnostic.roomId} client=${diagnostic.sessionId} event=${diagnostic.event} visibility=${diagnostic.visibility} online=${diagnostic.online} dom=${diagnostic.domNodes} heapMb=${diagnostic.heapMb ?? "n/a"} frameGapMs=${diagnostic.frameGapMs} closeCode=${diagnostic.closeCode ?? "n/a"} detail=${JSON.stringify(diagnostic.detail || "-")} run=${diagnostic.runId || "-"}`);
		}
		res.status(204).end();
	});

	app.get("/matches/:matchRoomId/spectator", async (req, res) => {
		try {
			const targetMatchRoomId = String(req.params.matchRoomId || "").trim();
			if (!targetMatchRoomId) {
				res.status(400).json({ error: "missing_match_room_id" });
				return;
			}
			const [matches, soloMatches] = await Promise.all([
				matchMaker.query({ name: "match" }),
				matchMaker.query({ name: "solo_match" })
			]);
			const activeMatch = [...matches, ...soloMatches].find((item: any) => String(item.roomId || "") === targetMatchRoomId && Number(item.clients || 0) > 0);
			if (!activeMatch) {
				res.status(404).json({ error: "match_room_not_found" });
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

