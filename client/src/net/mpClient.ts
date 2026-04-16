import * as Colyseus from "colyseus.js";

type LobbyPlayer = { slot: "p1" | "p2"; deckId: string; leaderId: string; ready: boolean };

export class MPClient {
	client!: Colyseus.Client;
	room!: Colyseus.Room;

	slot: "p1" | "p2" | null = null;
	roomId: string | null = null;
	selfSessionId: string | null = null;

	onLobbyState?: (data: { phase: string; players: LobbyPlayer[]; serverSeq: number }) => void;
	onStartMatch?: (data: any) => void;
	onStateSync?: (state: any) => void;
	onCardPlayed?: (data: any) => void;
	onError?: (data: any) => void;
	onLeave?: (code: number) => void;
	onLog?: (msg: string, obj?: any) => void;

	private async connectToRoom(endpoint: string, roomName: string, roomId?: string) {
		this.client = new Colyseus.Client(endpoint);

		this.room = roomId ? await this.client.joinById(roomId) : await this.client.create(roomName);

		this.roomId = this.room.id;

		this.room.onMessage("assign_slot", (msg: any) => {
			this.slot = msg.slot;
			this.selfSessionId = typeof msg?.sessionId === "string" ? msg.sessionId : null;
			this.onLog?.("ASSIGN_SLOT", msg);
		});

		this.room.onMessage("lobby_state", (msg: any) => {
			this.onLobbyState?.(msg);
		});

		this.room.onMessage("start_match", (msg: any) => {
			this.onStartMatch?.(msg);
		});

		this.room.onMessage("card_played", (msg: any) => {
			this.onCardPlayed?.(msg);
		});

		this.room.onMessage("phase_changed", (msg: any) => {
			this.onLog?.("PHASE_CHANGED", msg);
		});

		this.room.onMessage("turn_start", (msg: any) => {
			this.onLog?.("TURN_START", msg);
		});

		this.room.onMessage("attack_resolved", (msg: any) => {
			this.onLog?.("ATTACK_RESOLVED", msg);
		});

		this.room.onMessage("match_ended", (msg: any) => {
			this.onLog?.("MATCH_ENDED", msg);
		});

		this.room.onMessage("error", (msg: any) => {
			this.onError?.(msg);
		});

		this.room.onLeave((code) => {
			this.onLog?.("ROOM_LEAVE", { code });
			this.onLeave?.(code);
			this.slot = null;
			this.roomId = null;
			this.selfSessionId = null;
		});

		this.room.onStateChange((state: any) => {
			this.onStateSync?.(state);
			this.onLog?.("STATE_SYNC", {
				phase: state.phase,
				turn: state.game?.turn,
				turnSlot: state.game?.turnSlot,
				p1Hand: state.game?.p1?.hand,
				p2Hand: state.game?.p2?.hand,
				p1DeckLeft: state.game?.p1?.deck?.length,
				p2DeckLeft: state.game?.p2?.deck?.length
			});
		});

		this.onLog?.("JOINED", { roomId: this.room.id });
		return { roomId: this.room.id };
	}

	async connectLobby(endpoint: string, roomId?: string) {
		return this.connectToRoom(endpoint, "lobby", roomId);
	}

	async connectMatch(endpoint: string, roomId: string) {
		return this.connectToRoom(endpoint, "match", roomId);
	}

	async connect(endpoint: string, roomId?: string) {
		return this.connectLobby(endpoint, roomId);
	}

	chooseDeck(payload: string | { deckId: string; leaderId?: string; cards?: string[] }) {
		if (typeof payload === "string") {
			this.room?.send("choose_deck", { deckId: payload });
			return;
		}

		this.room?.send("choose_deck", {
			deckId: payload.deckId,
			leaderId: payload.leaderId,
			cards: Array.isArray(payload.cards) ? payload.cards : []
		});
	}

	chooseLeader(leaderId: string) {
		this.room?.send("choose_leader", { leaderId });
	}

	setReady(ready: boolean) {
		this.room?.send("ready", { ready });
	}

	playCard(cardId: string) {
		this.room?.send("play_card", { cardId });
	}

	attack(attackerPos: number, target: "leader" | "ally" = "leader", targetPos?: number) {
		this.room?.send("attack", { attackerPos, target, targetPos });
	}

	nextPhase() {
		this.room?.send("next_phase");
	}

	endTurn() {
		this.room?.send("end_turn");
	}
}

