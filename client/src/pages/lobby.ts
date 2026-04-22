/* Responsibility: wire Lobby UI with Colyseus network. This is the only place combining UI + NET. */

import { bindLobbyHandlers, connectClient, joinOrCreateLobby } from "../net/mp";
import { resolveHttpBase, resolveServerEndpoint } from "../config/runtime";
import { hydrateSavedDecks, readSavedDecks, type SavedDeck } from "../ui/deckStore";
import { getLobbyInputs, log, renderPlayers, renderRooms, setReadyUI, setSlotPhase } from "../ui/lobbyView";
import { getDisplayName } from "../ui/profile";

const view = getLobbyInputs();

let client: any = null;
let room: any = null;
let mySlot: "p1" | "p2" | null = null;
let roomId: string | null = null;
let myServerReady = false;
let isJoining = false;
let selectedDeck: SavedDeck | null = null;
let selectedRoomId: string | null = null;
let roomPollTimer: number | null = null;
let availableDecks: SavedDeck[] = readSavedDecks();
let deckRefreshToken = 0;

function applySelectedDeck(deck: SavedDeck | null) {
	selectedDeck = deck;
	if (view.leaderViewEl) view.leaderViewEl.textContent = selectedDeck?.leaderName || "—";
	if (view.deckCardsCountEl) view.deckCardsCountEl.textContent = selectedDeck ? String(selectedDeck.cards.length) : "—";
	if (view.leaderEl) view.leaderEl.value = selectedDeck?.leaderName || "";

	if (room && selectedDeck) {
		room.send("choose_deck", {
			deckId: selectedDeck.id,
			leaderId: selectedDeck.leaderName,
			cards: selectedDeck.cards
		});
	}
}

async function leaveCurrentLobby() {
	if (!room) return;
	try {
		await room.leave();
	} catch {
		// ignore switching-room leave failures
	}
	room = null;
	roomId = null;
	mySlot = null;
	myServerReady = false;
	setReadyUI(false);
	setSlotPhase(null, "—");
	if (view.roomIdViewEl) view.roomIdViewEl.textContent = "—";
}

function endpointToHttpBase(endpoint: string) {
	return resolveHttpBase(endpoint);
}

function renderDeckSelector() {
	if (!view.deckEl) return;
	const decks = availableDecks;
	const currentValue = view.deckEl.value;
	const selectedId = selectedDeck?.id || currentValue;
	view.deckEl.innerHTML = "";

	if (!decks.length) {
		const option = document.createElement("option");
		option.value = "";
		option.textContent = "(nenhum deck salvo - abra o deckbuilder no mesmo navegador)";
		view.deckEl.appendChild(option);
		applySelectedDeck(null);
		return;
	}

	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = "(selecione um deck salvo)";
	view.deckEl.appendChild(placeholder);

	for (const deck of decks) {
		const op = document.createElement("option");
		op.value = deck.id;
		op.textContent = `${deck.deckName} • Líder: ${deck.leaderName}`;
		view.deckEl.appendChild(op);
	}

	const nextDeck = decks.find((deck) => deck.id === selectedId) || (decks.length === 1 ? decks[0] : null);
	view.deckEl.value = nextDeck?.id || "";
	applySelectedDeck(nextDeck);
}

function syncSelectedDeckFromUI() {
	if (!view.deckEl) return;
	applySelectedDeck(availableDecks.find((d) => d.id === view.deckEl!.value) || null);
}


async function refreshSavedDecks() {
	const token = ++deckRefreshToken;
	const decks = await hydrateSavedDecks();
	if (token !== deckRefreshToken) return;
	availableDecks = decks;
	renderDeckSelector();
}

function renderRoomList(rooms: Array<{ roomId: string; clients: number; maxClients: number; metadata?: { title?: string; deckName?: string; leaderId?: string } }>) {
	renderRooms(rooms, selectedRoomId, (roomId) => {
		selectedRoomId = roomId;
		renderRoomList(rooms);
	}, (roomId) => {
		selectedRoomId = roomId;
		if (!view.roomIdEl) return;
		view.roomIdEl.value = roomId;
		if (view.btnJoinSelected) {
			view.btnJoinSelected.click();
			return;
		}
		void joinLobby();
	});
	if (!rooms.length) selectedRoomId = null;
}

async function refreshRooms() {
	if (!view.endpointEl) return;
	const base = endpointToHttpBase(view.endpointEl.value.trim());
	try {
		const resp = await fetch(`${base}/lobbies`);
		if (!resp.ok) throw new Error(`status_${resp.status}`);
		const data = await resp.json();
		renderRoomList(Array.isArray(data?.rooms) ? data.rooms : []);
	} catch (error) {
		log("ROOM_LIST_ERROR", { base, error: String(error) });
	}
}

function startRoomPolling() {
	if (roomPollTimer) window.clearInterval(roomPollTimer);
	void refreshRooms();
	roomPollTimer = window.setInterval(() => void refreshRooms(), 3000);
}

async function joinLobby(): Promise<boolean> {
	if (isJoining || !view.endpointEl || !view.roomIdEl) return false;
	isJoining = true;
	try {
		const requestedRoomId = view.roomIdEl.value.trim() || undefined;
		if (room && roomId && requestedRoomId && roomId !== requestedRoomId) {
			await leaveCurrentLobby();
		}
		log("JOINING", { endpoint: view.endpointEl.value.trim(), roomId: requestedRoomId || "(novo)" });
		client = await connectClient(view.endpointEl.value.trim());
		room = await joinOrCreateLobby(client, requestedRoomId);
		roomId = room.id;
		selectedRoomId = room.id;
		view.roomIdEl.value = room.id;
		if (view.roomIdViewEl) view.roomIdViewEl.textContent = room.id;

		const displayName = getDisplayName();
		if (displayName) {
			room.send("set_name", { name: displayName });
		}

		bindLobbyHandlers(room, {
			onAssignSlot: (msg) => {
				mySlot = msg?.slot || null;
				setSlotPhase(mySlot, view.phaseEl?.textContent || "—");
				log("ASSIGN_SLOT", msg);
			},
			onLobbyState: (msg) => {
				setSlotPhase(mySlot, String(msg?.phase || "—"));
				if (view.roomIdViewEl) view.roomIdViewEl.textContent = roomId || "—";
				renderPlayers(Array.isArray(msg?.players) ? msg.players : [], mySlot);
				const me = Array.isArray(msg?.players) ? msg.players.find((p: any) => p.slot === mySlot) : null;
				if (view.slotEl) {
					view.slotEl.textContent = me?.displayName ? `${me.displayName} (${mySlot || me.slot || "—"})` : (mySlot || "—");
				}
				myServerReady = !!me?.ready;
				setReadyUI(myServerReady);
			},
			onStartMatch: (msg) => {
				log("START_MATCH", msg);
				const endpoint = view.endpointEl?.value.trim() || resolveServerEndpoint(window.location.search);
				const matchRoomId = String(msg?.matchRoomId || "").trim();
				if (matchRoomId) {
					window.location.href = `./game.html?roomId=${encodeURIComponent(matchRoomId)}&endpoint=${encodeURIComponent(endpoint)}`;
				}
			},
			onError: (msg) => log("ERROR", msg),
			onLeave: (code) => {
				if (view.endpointEl) view.endpointEl.value = resolveServerEndpoint(window.location.search);
				room = null;
				roomId = null;
				mySlot = null;
				myServerReady = false;

				setReadyUI(false);
				setSlotPhase(null, "—");
				if (view.roomIdViewEl) view.roomIdViewEl.textContent = "—";
				log("ROOM_LEAVE", { code });
			}
		});

		syncSelectedDeckFromUI();
		log("JOINED", { roomId: room.id });
		return true;
	} catch (error) {
		log("JOIN_ERROR", { text: view.roomIdEl.value.trim() ? "Não foi possível entrar na sala selecionada." : "Não foi possível criar sala.", error: String(error) });
		return false;
	} finally {
		isJoining = false;
	}
}

if (view.btnJoin) {
	view.btnJoin.onclick = () => {
		if (view.roomIdEl && selectedRoomId && !view.roomIdEl.value.trim()) view.roomIdEl.value = selectedRoomId;
		void joinLobby();
	};
}
if (view.deckEl) view.deckEl.onchange = syncSelectedDeckFromUI;
window.addEventListener("storage", (event) => {
	if (event.key && event.key !== "mytragor_decks" && event.key !== "mytragor_play_deck") return;
	void refreshSavedDecks();
});
window.addEventListener("focus", () => void refreshSavedDecks());
document.addEventListener("visibilitychange", () => {
	if (!document.hidden) void refreshSavedDecks();
});
if (view.btnRefreshRooms) view.btnRefreshRooms.onclick = () => void refreshRooms();
if (view.btnJoinSelected) view.btnJoinSelected.onclick = () => {
	if (!view.roomIdEl || !selectedRoomId) return;
	view.roomIdEl.value = selectedRoomId;
	void joinLobby();
};
if (view.btnReady) {
	view.btnReady.onclick = async () => {
		if (!room) {
			const joined = await joinLobby();
			if (!joined || !room) {
				log("ERROR", { text: "Não foi possível entrar na sala para marcar Ready." });
				return;
			}
		}
		const nextReady = !myServerReady;
		if (nextReady && !selectedDeck) {
			log("ERROR", { text: "Selecione um deck salvo antes de ficar pronto." });
			return;
		}
		if (nextReady && selectedDeck) {
			room?.send("choose_deck", { deckId: selectedDeck.id, leaderId: selectedDeck.leaderName, cards: selectedDeck.cards });
			room?.send("choose_leader", { leaderId: selectedDeck.leaderName });
		}
		room?.send("ready", { ready: nextReady });
		log("READY_SENT", { ready: nextReady });
	};
}

const params = new URLSearchParams(window.location.search);
if (view.endpointEl) view.endpointEl.value = params.get("endpoint")?.trim() || resolveServerEndpoint(window.location.search);
if (view.roomIdEl) view.roomIdEl.value = params.get("roomId")?.trim() || "";

renderDeckSelector();
void refreshSavedDecks();
startRoomPolling();
if (view.roomIdEl?.value) void joinLobby();
