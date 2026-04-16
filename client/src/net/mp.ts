import * as Colyseus from "colyseus.js";

export type MpConfig = { endpoint: string };

export type LobbyHandlers = {
	onAssignSlot?: (msg: any) => void;
	onLobbyState?: (msg: any) => void;
	onStartMatch?: (msg: any) => void;
	onLeave?: (code: number) => void;
	onError?: (msg: any) => void;
};

export type MatchHandlers = {
	onAssignSlot?: (msg: any) => void;
	onStateSync?: (state: any) => void;
	onCardPlayed?: (msg: any) => void;
	onEffectChoice?: (msg: any) => void;
	onRevealTopCard?: (msg: any) => void;
	onError?: (msg: any) => void;
	onLeave?: (code: number) => void;
	onLog?: (name: string, msg: any) => void;
};

export async function connectClient(endpoint: string): Promise<Colyseus.Client> {
	const config: MpConfig = { endpoint };
	return new Colyseus.Client(config.endpoint);
}

export async function joinOrCreateLobby(client: Colyseus.Client, roomId?: string): Promise<Colyseus.Room> {
	if (!roomId) return client.create("lobby");
	return client.joinById(roomId);
}

export async function joinMatchById(client: Colyseus.Client, matchRoomId: string): Promise<Colyseus.Room> {
	return client.joinById(matchRoomId);
}

export function bindLobbyHandlers(room: Colyseus.Room, handlers: LobbyHandlers) {
	room.onMessage("assign_slot", (msg: any) => handlers.onAssignSlot?.(msg));
	room.onMessage("lobby_state", (msg: any) => handlers.onLobbyState?.(msg));
	room.onMessage("start_match", (msg: any) => handlers.onStartMatch?.(msg));
	room.onMessage("error", (msg: any) => handlers.onError?.(msg));
	room.onLeave((code) => handlers.onLeave?.(code));
}

export function bindMatchHandlers(room: Colyseus.Room, handlers: MatchHandlers) {
	room.onMessage("assign_slot", (msg: any) => handlers.onAssignSlot?.(msg));
	room.onMessage("card_played", (msg: any) => handlers.onCardPlayed?.(msg));
	room.onMessage("phase_changed", (msg: any) => handlers.onLog?.("PHASE_CHANGED", msg));
	room.onMessage("turn_start", (msg: any) => handlers.onLog?.("TURN_START", msg));
	room.onMessage("attack_resolved", (msg: any) => handlers.onLog?.("ATTACK_RESOLVED", msg));
	room.onMessage("match_ended", (msg: any) => handlers.onLog?.("MATCH_ENDED", msg));
	room.onMessage("effect_log", (msg: any) => handlers.onLog?.("EFFECT", msg));
	room.onMessage("effect_choice_required", (msg: any) => handlers.onEffectChoice?.(msg));
	room.onMessage("revealed_top_card", (msg: any) => handlers.onRevealTopCard?.(msg));
	room.onMessage("choice_waiting", (msg: any) => handlers.onLog?.("CHOICE_WAITING", msg));
	room.onMessage("choice_waiting_end", (msg: any) => handlers.onLog?.("CHOICE_WAITING_END", msg));
	room.onMessage("error", (msg: any) => handlers.onError?.(msg));
	room.onStateChange((state: any) => handlers.onStateSync?.(state));
	room.onLeave((code) => handlers.onLeave?.(code));
}
