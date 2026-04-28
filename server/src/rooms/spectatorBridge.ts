import { MatchState } from "./schema/MatchState";

type PublicSlot = "p1" | "p2";

const HIDDEN_HAND_CARD = "__spectator_hand_hidden__";
const HIDDEN_DECK_CARD = "__spectator_deck_hidden__";

export type SpectatorEventName = "card_played" | "phase_changed" | "turn_start" | "attack_resolved" | "match_ended";

export type SpectatorPlayerInfo = {
	slot: PublicSlot;
	displayName: string;
};

export type SpectatorPlayerView = {
	slot: PublicSlot;
	deckId: string;
	leaderId: string;
	deck: string[];
	hand: string[];
	field: string[];
	fieldHp: number[];
	fieldTapped: boolean[];
	fieldFrozen: number[];
	fieldPinnedUntilTurn: number[];
	fieldAtkTemp: number[];
	fieldAtkPerm: number[];
	fieldAcPerm: number[];
	fieldSedeMark: number[];
	fieldBloodMarks: number[];
	fieldBlessing: number[];
	fieldVitalMarks: number[];
	support: string[];
	supportAttachTo: number[];
	supportCounters: number[];
	env: string;
	grave: string[];
	banished: string[];
	leaderTapped: boolean;
	leaderFrozen: number;
	leaderPinnedUntilTurn: number;
	leaderBlessing: number;
	leaderVitalMarks: number;
	leaderSpiderMarks: number;
	sedeVingancaTurn: number;
	fragments: number;
	fragmentMax: number;
	hp: number;
};

export type SpectatorSnapshot = {
	phase: string;
	serverSeq: number;
	players: Record<PublicSlot, SpectatorPlayerInfo>;
	game: {
		starterSlot: PublicSlot;
		turnSlot: PublicSlot;
		turn: number;
		seq: number;
		phase: string;
		p1: SpectatorPlayerView;
		p2: SpectatorPlayerView;
	};
};

type SpectatorListener = {
	onSnapshot: (snapshot: SpectatorSnapshot) => void;
	onEvent: (name: SpectatorEventName, payload: any) => void;
};

type SpectatorChannel = {
	snapshot: SpectatorSnapshot | null;
	spectatorRoomId: string | null;
	listeners: Set<SpectatorListener>;
};

const channels = new Map<string, SpectatorChannel>();

function ensureChannel(matchRoomId: string): SpectatorChannel {
	const key = String(matchRoomId || "").trim();
	let channel = channels.get(key);
	if (!channel) {
		channel = { snapshot: null, spectatorRoomId: null, listeners: new Set() };
		channels.set(key, channel);
	}
	return channel;
}

function toStringArray(value: any): string[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => String(item || ""));
	if (typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<any>).map((item) => String(item || ""));
	return [];
}

function toNumberArray(value: any): number[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => Number(item || 0));
	if (typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<any>).map((item) => Number(item || 0));
	return [];
}

function toBoolArray(value: any): boolean[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => !!item);
	if (typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<any>).map((item) => !!item);
	return [];
}

function hiddenCards(total: number, token: string): string[] {
	const size = Math.max(0, Number(total || 0));
	return Array.from({ length: size }, () => token);
}

function findDisplayName(state: MatchState, slot: PublicSlot): string {
	for (const player of state.players.values()) {
		if (player.slot === slot) return String(player.displayName || "").trim() || (slot === "p1" ? "Jogador 1" : "Jogador 2");
	}
	return slot === "p1" ? "Jogador 1" : "Jogador 2";
}

function sanitizePlayer(player: any, slot: PublicSlot): SpectatorPlayerView {
	return {
		slot,
		deckId: String(player?.deckId || ""),
		leaderId: String(player?.leaderId || ""),
		deck: hiddenCards(toStringArray(player?.deck).length, HIDDEN_DECK_CARD),
		hand: hiddenCards(toStringArray(player?.hand).length, HIDDEN_HAND_CARD),
		field: toStringArray(player?.field),
		fieldHp: toNumberArray(player?.fieldHp),
		fieldTapped: toBoolArray(player?.fieldTapped),
		fieldFrozen: toNumberArray(player?.fieldFrozen),
		fieldPinnedUntilTurn: toNumberArray(player?.fieldPinnedUntilTurn),
		fieldAtkTemp: toNumberArray(player?.fieldAtkTemp),
		fieldAtkPerm: toNumberArray(player?.fieldAtkPerm),
		fieldAcPerm: toNumberArray(player?.fieldAcPerm),
		fieldSedeMark: toNumberArray(player?.fieldSedeMark),
		fieldBloodMarks: toNumberArray(player?.fieldBloodMarks),
		fieldBlessing: toNumberArray(player?.fieldBlessing),
		fieldVitalMarks: toNumberArray(player?.fieldVitalMarks),
		support: toStringArray(player?.support),
		supportAttachTo: toNumberArray(player?.supportAttachTo),
		supportCounters: toNumberArray(player?.supportCounters),
		env: String(player?.env || ""),
		grave: toStringArray(player?.grave),
		banished: toStringArray(player?.banished),
		leaderTapped: !!player?.leaderTapped,
		leaderFrozen: Number(player?.leaderFrozen || 0),
		leaderPinnedUntilTurn: Number(player?.leaderPinnedUntilTurn || 0),
		leaderBlessing: Number(player?.leaderBlessing || 0),
		leaderVitalMarks: Number(player?.leaderVitalMarks || 0),
		leaderSpiderMarks: Number(player?.leaderSpiderMarks || 0),
		sedeVingancaTurn: Number(player?.sedeVingancaTurn || 0),
		fragments: Number(player?.fragments || 0),
		fragmentMax: Number(player?.fragmentMax || 0),
		hp: Number(player?.hp || 0)
	};
}

export function buildSpectatorSnapshot(state: MatchState): SpectatorSnapshot {
	return {
		phase: String(state.phase || "IN_MATCH"),
		serverSeq: Number(state.serverSeq || 0),
		players: {
			p1: { slot: "p1", displayName: findDisplayName(state, "p1") },
			p2: { slot: "p2", displayName: findDisplayName(state, "p2") }
		},
		game: {
			starterSlot: state.game.starterSlot === "p2" ? "p2" : "p1",
			turnSlot: state.game.turnSlot === "p2" ? "p2" : "p1",
			turn: Number(state.game.turn || 1),
			seq: Number(state.game.seq || 0),
			phase: String(state.game.phase || "INITIAL"),
			p1: sanitizePlayer(state.game.p1, "p1"),
			p2: sanitizePlayer(state.game.p2, "p2")
		}
	};
}

export function registerSpectatorRoom(matchRoomId: string, spectatorRoomId: string): void {
	const channel = ensureChannel(matchRoomId);
	channel.spectatorRoomId = String(spectatorRoomId || "").trim() || null;
}

export function getSpectatorRoomId(matchRoomId: string): string | null {
	return ensureChannel(matchRoomId).spectatorRoomId;
}

export function subscribeSpectatorChannel(matchRoomId: string, listener: SpectatorListener): () => void {
	const channel = ensureChannel(matchRoomId);
	channel.listeners.add(listener);
	if (channel.snapshot) listener.onSnapshot(channel.snapshot);
	return () => {
		channel.listeners.delete(listener);
	};
}

export function publishSpectatorSnapshot(matchRoomId: string, snapshot: SpectatorSnapshot): void {
	const channel = ensureChannel(matchRoomId);
	channel.snapshot = snapshot;
	for (const listener of channel.listeners) listener.onSnapshot(snapshot);
}

export function relaySpectatorEvent(matchRoomId: string, name: string, payload: any): void {
	if (!["card_played", "phase_changed", "turn_start", "attack_resolved", "match_ended"].includes(name)) return;
	const channel = ensureChannel(matchRoomId);
	for (const listener of channel.listeners) listener.onEvent(name as SpectatorEventName, payload);
}

export function disposeSpectatorChannel(matchRoomId: string): void {
	channels.delete(String(matchRoomId || "").trim());
}