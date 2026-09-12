import * as Colyseus from "colyseus.js";
export class MPClient {
    constructor() {
        this.slot = null;
        this.roomId = null;
        this.selfSessionId = null;
    }
    async connectToRoom(endpoint, roomName, roomId) {
        this.client = new Colyseus.Client(endpoint);
        this.room = roomId ? await this.client.joinById(roomId) : await this.client.create(roomName);
        this.roomId = this.room.id;
        this.room.onMessage("assign_slot", (msg) => {
            this.slot = msg.slot;
            this.selfSessionId = typeof msg?.sessionId === "string" ? msg.sessionId : null;
            this.onLog?.("ASSIGN_SLOT", msg);
        });
        this.room.onMessage("lobby_state", (msg) => {
            this.onLobbyState?.(msg);
        });
        this.room.onMessage("start_match", (msg) => {
            this.onStartMatch?.(msg);
        });
        this.room.onMessage("card_played", (msg) => {
            this.onCardPlayed?.(msg);
        });
        this.room.onMessage("phase_changed", (msg) => {
            this.onLog?.("PHASE_CHANGED", msg);
        });
        this.room.onMessage("turn_start", (msg) => {
            this.onLog?.("TURN_START", msg);
        });
        this.room.onMessage("attack_resolved", (msg) => {
            this.onLog?.("ATTACK_RESOLVED", msg);
        });
        this.room.onMessage("match_ended", (msg) => {
            this.onLog?.("MATCH_ENDED", msg);
        });
        this.room.onMessage("error", (msg) => {
            this.onError?.(msg);
        });
        this.room.onLeave((code) => {
            this.onLog?.("ROOM_LEAVE", { code });
            this.onLeave?.(code);
            this.slot = null;
            this.roomId = null;
            this.selfSessionId = null;
        });
        this.room.onStateChange((state) => {
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
    async connectLobby(endpoint, roomId) {
        return this.connectToRoom(endpoint, "lobby", roomId);
    }
    async connectMatch(endpoint, roomId) {
        return this.connectToRoom(endpoint, "match", roomId);
    }
    async connect(endpoint, roomId) {
        return this.connectLobby(endpoint, roomId);
    }
    chooseDeck(payload) {
        if (typeof payload === "string") {
            this.room?.send("choose_deck", { deckId: payload });
            return;
        }
        this.room?.send("choose_deck", {
            deckId: payload.deckId,
            leaderId: payload.leaderId,
            cards: Array.isArray(payload.cards) ? payload.cards : [],
            accessories: payload.accessories || {}
        });
    }
    chooseLeader(leaderId) {
        this.room?.send("choose_leader", { leaderId });
    }
    setReady(ready) {
        this.room?.send("ready", { ready });
    }
    playCard(cardId) {
        this.room?.send("play_card", { cardId });
    }
    attack(attackerPos, target = "leader", targetPos) {
        this.room?.send("attack", { attackerPos, target, targetPos });
    }
    nextPhase() {
        this.room?.send("next_phase", {});
    }
    endTurn() {
        this.room?.send("end_turn", {});
    }
}
