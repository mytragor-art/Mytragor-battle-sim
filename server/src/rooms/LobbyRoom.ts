/* Responsibility: lobby-only room (deck/leader/ready), creates MatchRoom and emits start_match. */

import { randomUUID } from "crypto";
import { Room, Client, matchMaker } from "colyseus";
import { LobbyState, LobbyPlayer, type Slot } from "./schema/LobbyState";

export class LobbyRoom extends Room<LobbyState> {
	maxClients = 2;
	private selectedDeckBySession = new Map<string, { deckId: string; leaderId: string; cards: string[] }>();

	private sanitizeDisplayName(name: unknown): string {
		return String(name || "").trim().slice(0, 18);
	}

	onCreate(options: any) {
		this.setState(new LobbyState());
		this.setMetadata({
			title: String(options?.title || "Desafio Mytragor"),
			deckName: String(options?.deckName || ""),
			leaderId: String(options?.leaderId || "")
		});

		this.onMessage("choose_deck", (client, msg: { deckId?: string; leaderId?: string; cards?: string[] }) => {
			const p = this.state.players.get(client.sessionId);
			if (!p || this.state.phase !== "LOBBY") return;
			p.deckId = String(msg?.deckId || "");
			p.leaderId = String(msg?.leaderId || p.leaderId || "");

			const cards = Array.isArray(msg?.cards) ? msg!.cards!.map((c) => String(c)).filter(Boolean) : [];
			this.selectedDeckBySession.set(client.sessionId, {
				deckId: p.deckId,
				leaderId: p.leaderId,
				cards
			});

			p.ready = false;
			this.refreshMetadata();
			this.broadcastLobby();
		});

		this.onMessage("choose_leader", (client, msg: { leaderId?: string }) => {
			const p = this.state.players.get(client.sessionId);
			if (!p || this.state.phase !== "LOBBY") return;
			p.leaderId = String(msg?.leaderId || "");
			p.ready = false;
			this.refreshMetadata();
			this.broadcastLobby();
		});

		this.onMessage("ready", (client, msg: { ready?: boolean }) => {
			const p = this.state.players.get(client.sessionId);
			if (!p || this.state.phase !== "LOBBY") return;

			const wantReady = !!msg?.ready;
			const canReady = p.deckId.length > 0 && p.leaderId.length > 0;
			p.ready = wantReady && canReady;

			this.broadcastLobby();
			void this.tryStartMatch();
		});

		this.onMessage("set_name", (client, msg: { name?: string }) => {
			const p = this.state.players.get(client.sessionId);
			if (!p) return;
			p.displayName = this.sanitizeDisplayName(msg?.name);
			this.refreshMetadata();
			this.broadcastLobby();
		});
	}

	onJoin(client: Client) {
		const slot = this.assignSlot();
		const lp = new LobbyPlayer();
		lp.sessionId = client.sessionId;
		lp.slot = slot;
		this.state.players.set(client.sessionId, lp);
		this.refreshMetadata();

		client.send("assign_slot", { slot, sessionId: client.sessionId });
		this.broadcastLobby();
	}

	onLeave(client: Client) {
		this.state.players.delete(client.sessionId);
		this.selectedDeckBySession.delete(client.sessionId);
		this.state.phase = "LOBBY";
		this.refreshMetadata();
		this.broadcastLobby();
	}

	private refreshMetadata() {
		const p1 = this.findBySlot("p1");
		const titleBase = p1?.displayName ? `Desafio de ${p1.displayName}` : "Desafio Mytragor";
		this.setMetadata({
			title: titleBase,
			deckName: String(p1?.deckId || ""),
			leaderId: String(p1?.leaderId || "")
		});
	}

	private assignSlot(): Slot {
		const taken = new Set<Slot>();
		for (const p of this.state.players.values()) taken.add(p.slot);
		return taken.has("p1") ? "p2" : "p1";
	}

	private broadcastLobby() {
		const players = [...this.state.players.values()].map((p) => ({
			slot: p.slot,
			displayName: p.displayName,
			deckId: p.deckId,
			leaderId: p.leaderId,
			ready: p.ready
		}));

		this.broadcast("lobby_state", {
			phase: this.state.phase,
			players,
			seq: ++this.state.seq
		});
	}

	private findBySlot(slot: Slot) {
		for (const p of this.state.players.values()) if (p.slot === slot) return p;
		return null;
	}

	private async tryStartMatch() {
		if (this.state.phase !== "LOBBY") return;
		if (this.clients.length < 2) return;

		const p1 = this.findBySlot("p1");
		const p2 = this.findBySlot("p2");
		if (!p1 || !p2) return;

		const bothReady =
			p1.ready &&
			p2.ready &&
			p1.deckId.length > 0 &&
			p2.deckId.length > 0 &&
			p1.leaderId.length > 0 &&
			p2.leaderId.length > 0;

		if (!bothReady) return;

		this.state.phase = "STARTING";
		this.broadcastLobby();
		this.lock();

		const p1Deck = this.selectedDeckBySession.get(p1.sessionId);
		const p2Deck = this.selectedDeckBySession.get(p2.sessionId);
		const starterSlot: Slot = Math.random() < 0.5 ? "p1" : "p2";
		const seatReservations = [
			{
				joinToken: randomUUID(),
				lobbySessionId: p1.sessionId,
				slot: "p1" as Slot,
				displayName: p1.displayName
			},
			{
				joinToken: randomUUID(),
				lobbySessionId: p2.sessionId,
				slot: "p2" as Slot,
				displayName: p2.displayName
			}
		];

		const matchRoom = await matchMaker.createRoom("match", {
			p1: {
				deckId: p1.deckId,
				leaderId: p1.leaderId,
				cards: p1Deck?.cards || []
			},
			p2: {
				deckId: p2.deckId,
				leaderId: p2.leaderId,
				cards: p2Deck?.cards || []
			},
			starterSlot,
			seatReservations
		});

		const spectatorRoom = await matchMaker.createRoom("spectator", {
			matchRoomId: matchRoom.roomId
		});

		for (const reservation of seatReservations) {
			const targetClient = this.clients.find((client) => client.sessionId === reservation.lobbySessionId);
			if (!targetClient) continue;
			targetClient.send("start_match", {
				matchRoomId: matchRoom.roomId,
				spectatorRoomId: spectatorRoom.roomId,
				joinToken: reservation.joinToken,
				slot: reservation.slot,
				starterSlot
			});
		}

		this.disconnect();
	}
}
