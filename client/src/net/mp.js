import * as Colyseus from "colyseus.js";
export async function connectClient(endpoint) {
    const config = { endpoint };
    return new Colyseus.Client(config.endpoint);
}
export async function joinOrCreateLobby(client, roomId, forceCreate = false) {
    if (forceCreate)
        return client.create("lobby");
    if (!roomId)
        return client.joinOrCreate("lobby", { queue: "public" });
    return client.joinById(roomId);
}
export async function createPrivateLobby(client, privateCode) {
    return client.create("private_lobby", { queue: "private", privateCode });
}
export async function joinPrivateLobby(client, privateCode) {
    return client.join("private_lobby", { queue: "private", privateCode });
}
export async function joinOrCreateNamedRoom(client, roomName, roomId, forceCreate = false) {
    if (forceCreate || !roomId)
        return client.create(roomName);
    return client.joinById(roomId);
}
export async function joinMatchById(client, matchRoomId, options) {
    return client.joinById(matchRoomId, options);
}
export async function resolveSpectatorRoomId(endpoint, matchRoomId) {
    const normalizedEndpoint = String(endpoint || "").trim();
    const httpEndpoint = normalizedEndpoint.replace(/^ws/i, "http").replace(/\/+$/, "");
    const response = await fetch(`${httpEndpoint}/matches/${encodeURIComponent(matchRoomId)}/spectator`);
    if (!response.ok) {
        throw new Error(`spectator_room_lookup_failed:${response.status}`);
    }
    const payload = await response.json();
    const spectatorRoomId = String(payload?.spectatorRoomId || "").trim();
    if (!spectatorRoomId)
        throw new Error("spectator_room_lookup_empty");
    return spectatorRoomId;
}
export function bindLobbyHandlers(room, handlers) {
    room.onMessage("assign_slot", (msg) => handlers.onAssignSlot?.(msg));
    room.onMessage("lobby_state", (msg) => handlers.onLobbyState?.(msg));
    room.onMessage("start_match", (msg) => handlers.onStartMatch?.(msg));
    room.onMessage("error", (msg) => handlers.onError?.(msg));
    room.onLeave((code) => handlers.onLeave?.(code));
}
export function bindMatchHandlers(room, handlers) {
    room.onMessage("assign_slot", (msg) => handlers.onAssignSlot?.(msg));
    room.onMessage("card_played", (msg) => handlers.onCardPlayed?.(msg));
    room.onMessage("phase_changed", (msg) => handlers.onLog?.("PHASE_CHANGED", msg));
    room.onMessage("turn_start", (msg) => handlers.onLog?.("TURN_START", msg));
    room.onMessage("mulligan_resolved", (msg) => handlers.onLog?.("MULLIGAN_RESOLVED", msg));
    room.onMessage("attack_resolved", (msg) => handlers.onLog?.("ATTACK_RESOLVED", msg));
    room.onMessage("match_ended", (msg) => handlers.onLog?.("MATCH_ENDED", msg));
    room.onMessage("effect_log", (msg) => handlers.onLog?.("EFFECT", msg));
    room.onMessage("effect_choice_required", (msg) => handlers.onEffectChoice?.(msg));
    room.onMessage("revealed_top_card", (msg) => handlers.onRevealTopCard?.(msg));
    room.onMessage("opponent_reconnecting", (msg) => handlers.onOpponentReconnecting?.(msg));
    room.onMessage("opponent_reconnected", (msg) => handlers.onOpponentReconnected?.(msg));
    room.onMessage("choice_waiting", (msg) => handlers.onLog?.("CHOICE_WAITING", msg));
    room.onMessage("choice_waiting_end", (msg) => handlers.onLog?.("CHOICE_WAITING_END", msg));
    room.onMessage("error", (msg) => handlers.onError?.(msg));
    room.onStateChange((state) => handlers.onStateSync?.(state));
    if (room.state)
        handlers.onStateSync?.(room.state);
    room.onLeave((code) => handlers.onLeave?.(code));
}
