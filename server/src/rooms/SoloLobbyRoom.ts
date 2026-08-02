import { randomUUID } from "crypto";
import { Room, Client, matchMaker } from "colyseus";
import { LobbyState, LobbyPlayer } from "./schema/LobbyState";

const SOLO_BOT_LEADERS = [
	"Valbrak, O Mago Popular",
	"Katsu, o Vingador",
	"Leafae, Guardião da Floresta",
	"Ademais, Aranhas Negras"
];

const SOLO_BOT_NAMES = ["Arauto Autômato", "Estrategista Arcano", "Guardião de Simulação", "Desafiante Sintético"];

function randomItem<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

export class SoloLobbyRoom extends Room<LobbyState> {
	maxClients = 1;
	private selectedDeckBySession = new Map<string, { deckId: string; leaderId: string; cards: string[]; accessories?: { sleeve?: string; playmat?: string } }>();
	private botDeckSelection: { deckId: string; leaderId: string; cards: string[]; accessories?: { sleeve?: string; playmat?: string } } | null = null;
	private readonly botPlayerKey = "solo-bot";

	private sanitizeDisplayName(name: unknown): string {
		return String(name || "").trim().slice(0, 18);
	}

	private sanitizeAvatarId(avatarId: unknown): string {
		const allowed = new Set(["chosen:valbrak", "chosen:katsu", "chosen:leafae", "chosen:ademais", "filiacao:arcana", "filiacao:marcial", "filiacao:religioso", "filiacao:sombras"]);
		const value = String(avatarId || "").trim();
		return allowed.has(value) ? value : "";
	}

	onCreate(options: any) {
		this.setState(new LobbyState());
		this.setMetadata({
			title: String(options?.title || "Desafio Solo Mytragor"),
			deckName: String(options?.deckName || ""),
			leaderId: String(options?.leaderId || ""),
			botName: "IA"
		});

		this.onMessage("choose_deck", (client, msg: { deckId?: string; leaderId?: string; cards?: string[]; accessories?: { sleeve?: string; playmat?: string } }) => {
			const player = this.state.players.get(client.sessionId);
			if (!player || this.state.phase !== "LOBBY") return;
			player.deckId = String(msg?.deckId || "");
			player.leaderId = String(msg?.leaderId || player.leaderId || "");

			const cards = Array.isArray(msg?.cards) ? msg.cards.map((card) => String(card)).filter(Boolean) : [];
			this.selectedDeckBySession.set(client.sessionId, {
				deckId: player.deckId,
				leaderId: player.leaderId,
				cards,
				accessories: msg?.accessories ? {
					sleeve: String(msg.accessories.sleeve || "").trim() || undefined,
					playmat: String(msg.accessories.playmat || "").trim() || undefined
				} : undefined
			});

			player.ready = false;
			this.refreshMetadata();
			this.broadcastLobby();
		});

		this.onMessage("choose_leader", (client, msg: { leaderId?: string }) => {
			const player = this.state.players.get(client.sessionId);
			if (!player || this.state.phase !== "LOBBY") return;
			player.leaderId = String(msg?.leaderId || "");
			player.ready = false;
			this.refreshMetadata();
			this.broadcastLobby();
		});

		this.onMessage("ready", (client, msg: { ready?: boolean }) => {
			const player = this.state.players.get(client.sessionId);
			if (!player || this.state.phase !== "LOBBY") return;

			const wantReady = !!msg?.ready;
			const canReady = player.deckId.length > 0 && player.leaderId.length > 0 && !!this.botDeckSelection?.deckId && !!this.botDeckSelection?.leaderId;
			player.ready = wantReady && canReady;

			this.broadcastLobby();
			void this.tryStartMatch();
		});

		this.onMessage("choose_bot_deck", (_client, msg: { deckId?: string; leaderId?: string; cards?: string[]; accessories?: { sleeve?: string; playmat?: string } }) => {
			const bot = this.getBotPlayer();
			if (!bot || this.state.phase !== "LOBBY") return;
			bot.deckId = String(msg?.deckId || "");
			bot.leaderId = String(msg?.leaderId || "");
			bot.ready = bot.deckId.length > 0 && bot.leaderId.length > 0;

			const cards = Array.isArray(msg?.cards) ? msg.cards.map((card) => String(card)).filter(Boolean) : [];
			this.botDeckSelection = bot.ready ? {
				deckId: bot.deckId,
				leaderId: bot.leaderId,
				cards,
				accessories: msg?.accessories ? {
					sleeve: String(msg.accessories.sleeve || "").trim() || undefined,
					playmat: String(msg.accessories.playmat || "").trim() || undefined
				} : undefined
			} : null;

			const human = this.getHumanPlayer();
			if (human?.ready && !bot.ready) human.ready = false;
			this.refreshMetadata();
			this.broadcastLobby();
		});

		this.onMessage("set_name", (client, msg: { name?: string; avatarId?: string }) => {
			const player = this.state.players.get(client.sessionId);
			if (!player) return;
			player.displayName = this.sanitizeDisplayName(msg?.name);
			player.avatarId = this.sanitizeAvatarId(msg?.avatarId);
			this.refreshMetadata();
			this.broadcastLobby();
		});
	}

	onJoin(client: Client) {
		const human = new LobbyPlayer();
		human.sessionId = client.sessionId;
		human.slot = "p1";
		this.state.players.set(client.sessionId, human);

		const bot = new LobbyPlayer();
		bot.sessionId = this.botPlayerKey;
		bot.slot = "p2";
		bot.displayName = "IA";
		bot.ready = false;
		bot.deckId = "";
		bot.leaderId = "";
		this.state.players.set(this.botPlayerKey, bot);
		this.botDeckSelection = null;

		this.refreshMetadata();
		client.send("assign_slot", { slot: "p1", sessionId: client.sessionId });
		this.broadcastLobby();
	}

	onLeave(client: Client) {
		this.state.players.delete(client.sessionId);
		this.state.players.delete(this.botPlayerKey);
		this.selectedDeckBySession.delete(client.sessionId);
		this.botDeckSelection = null;
		this.state.phase = "LOBBY";
		this.refreshMetadata();
		this.broadcastLobby();
	}

	private getHumanPlayer() {
		for (const [key, player] of this.state.players.entries()) {
			if (key !== this.botPlayerKey) return player;
		}
		return null;
	}

	private getBotPlayer() {
		return this.state.players.get(this.botPlayerKey) || null;
	}

	private refreshMetadata() {
		const human = this.getHumanPlayer();
		const bot = this.getBotPlayer();
		const titleBase = human?.displayName ? `Desafio solo de ${human.displayName}` : "Desafio Solo Mytragor";
		this.setMetadata({
			title: titleBase,
			deckName: String(human?.deckId || ""),
			leaderId: String(human?.leaderId || ""),
			botName: String(bot?.displayName || "IA"),
			botLeaderId: String(bot?.leaderId || ""),
			botDeckId: String(bot?.deckId || "")
		});
	}

	private broadcastLobby() {
		const players = [...this.state.players.values()].map((player) => ({
			slot: player.slot,
			displayName: player.displayName,
			avatarId: player.avatarId,
			deckId: player.deckId,
			leaderId: player.leaderId,
			ready: player.ready
		}));

		this.broadcast("lobby_state", {
			phase: this.state.phase,
			players,
			seq: ++this.state.seq
		});
	}

	private async tryStartMatch() {
		if (this.state.phase !== "LOBBY") return;
		const human = this.getHumanPlayer();
		const bot = this.getBotPlayer();
		if (!human || !bot) return;
		if (!human.ready || !human.deckId || !human.leaderId) return;
		if (!this.botDeckSelection?.deckId || !this.botDeckSelection?.leaderId) return;

		this.state.phase = "STARTING";
		this.broadcastLobby();
		this.lock();

		const p1Deck = this.selectedDeckBySession.get(human.sessionId);
		const p2Deck = this.botDeckSelection;
		const starterSlot = Math.random() < 0.5 ? "p1" : "p2";
		const seatReservation = {
			joinToken: randomUUID(),
			lobbySessionId: human.sessionId,
			slot: "p1" as const,
			displayName: human.displayName,
			avatarId: human.avatarId
		};
		const botName = randomItem(SOLO_BOT_NAMES);

		const matchRoom = await matchMaker.createRoom("solo_match", {
			p1: {
				deckId: human.deckId,
				leaderId: human.leaderId,
				cards: p1Deck?.cards || [],
				accessories: p1Deck?.accessories || {}
			},
			p2: {
				deckId: p2Deck.deckId,
				leaderId: p2Deck.leaderId,
				cards: p2Deck.cards,
				accessories: p2Deck.accessories || {}
			},
			starterSlot,
			seatReservation,
			bot: {
				displayName: botName,
				leaderId: p2Deck.leaderId,
				deckId: p2Deck.deckId,
				cards: p2Deck.cards,
				accessories: p2Deck.accessories || {}
			}
		});

		const targetClient = this.clients.find((entry) => entry.sessionId === human.sessionId);
		if (targetClient) {
			targetClient.send("start_match", {
				matchRoomId: matchRoom.roomId,
				joinToken: seatReservation.joinToken,
				slot: "p1",
				starterSlot,
				mode: "solo"
			});
		}

		this.disconnect();
	}
}