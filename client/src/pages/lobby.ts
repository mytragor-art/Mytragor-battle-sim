/* Responsibility: wire Lobby UI with Colyseus network. This is the only place combining UI + NET. */

import { bindLobbyHandlers, connectClient, createPrivateLobby, joinOrCreateLobby, joinPrivateLobby } from "../net/mp";
import { resolveHttpBase, resolveServerEndpoint } from "../config/runtime";
import { hydrateSavedDecks, readSavedDecks, resolveDeckAssetPath, resolveLeaderArtwork, type SavedDeck } from "../ui/deckStore";
import { getLobbyInputs, log, renderMatches, renderPlayers, renderRooms, setReadyUI, setSlotPhase } from "../ui/lobbyView";
import { getAvatarId, getDisplayName } from "../ui/profile";

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
let selectedMatchRoomId: string | null = null;
let pendingDeckId: string | null = null;

function normalizePrivateCode(value: string) {
	return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function generatePrivateCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let code = "";
	for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
	return code;
}

function setPrivateCode(code: string) {
	const normalized = normalizePrivateCode(code);
	if (view.privateCodeEl) view.privateCodeEl.value = normalized;
	if (view.privateCodeViewEl) view.privateCodeViewEl.textContent = normalized || "—";
	return normalized;
}

async function copyPrivateCode() {
	const code = normalizePrivateCode(view.privateCodeEl?.value || view.privateCodeViewEl?.textContent || "");
	if (!code) {
		log("ERROR", { text: "Nenhum código privado para copiar." });
		return;
	}
	try {
		await navigator.clipboard.writeText(code);
	} catch {
		const input = document.createElement("input");
		input.value = code;
		document.body.appendChild(input);
		input.select();
		document.execCommand("copy");
		input.remove();
	}
	log("PRIVATE_CODE_COPIED", { code });
}

async function sharePrivateCode() {
	const code = normalizePrivateCode(view.privateCodeEl?.value || view.privateCodeViewEl?.textContent || "");
	if (!code) {
		log("ERROR", { text: "Crie uma sala privada antes de compartilhar o código." });
		return;
	}
	const text = `Entre no meu duelo em Mytragor com o código: ${code}`;
	try {
		if (navigator.share) {
			await navigator.share({ title: "Duelo Mytragor", text });
		} else {
			await navigator.clipboard.writeText(text);
		}
		log("PRIVATE_CODE_SHARED", { code });
	} catch (error) {
		if ((error as DOMException | undefined)?.name !== "AbortError") log("SHARE_ERROR", { error: String(error) });
	}
}

function applySelectedDeck(deck: SavedDeck | null) {
	selectedDeck = deck;
	if (view.leaderViewEl) view.leaderViewEl.textContent = selectedDeck?.leaderName || "—";
	if (view.deckCardsCountEl) view.deckCardsCountEl.textContent = selectedDeck ? String(selectedDeck.cards.length) : "—";
	if (view.leaderEl) view.leaderEl.value = selectedDeck?.leaderName || "";
	if (view.activeDeckNameEl) view.activeDeckNameEl.textContent = selectedDeck?.deckName || "Escolha um baralho";
	if (view.activeDeckLeaderEl) view.activeDeckLeaderEl.textContent = `Líder: ${selectedDeck?.leaderName || "—"}`;
	if (view.activeDeckCardsEl) view.activeDeckCardsEl.textContent = selectedDeck ? String(selectedDeck.cards.length) : "—";
	if (view.activeDeckFragmentLabelEl) view.activeDeckFragmentLabelEl.textContent = selectedDeck?.fragImg ? "Fragmento selecionado" : "Fragmento: —";
	if (view.activeDeckLeaderArtEl) {
		view.activeDeckLeaderArtEl.src = selectedDeck ? resolveLeaderArtwork(selectedDeck) : "/publicadas/ui/layout-background.ai.thumb.webp";
		view.activeDeckLeaderArtEl.alt = selectedDeck ? `Líder ${selectedDeck.leaderName}` : "Líder do baralho selecionado";
	}
	if (view.activeDeckFragmentArtEl) {
		view.activeDeckFragmentArtEl.hidden = !selectedDeck?.fragImg;
		if (selectedDeck?.fragImg) view.activeDeckFragmentArtEl.src = resolveDeckAssetPath(selectedDeck.fragImg);
	}
	if (view.btnPreviousDeck) view.btnPreviousDeck.disabled = availableDecks.length < 2;
	if (view.btnNextDeck) view.btnNextDeck.disabled = availableDecks.length < 2;

	if (room && selectedDeck) {
		room.send("choose_deck", {
			deckId: selectedDeck.id,
			leaderId: selectedDeck.leaderName,
			cards: selectedDeck.cards,
			accessories: selectedDeck.accessories || {}
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
	const selectedId = pendingDeckId || selectedDeck?.id || currentValue;
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
	if (nextDeck && pendingDeckId === nextDeck.id) pendingDeckId = null;
	applySelectedDeck(nextDeck);
}

function syncSelectedDeckFromUI() {
	if (!view.deckEl) return;
	applySelectedDeck(availableDecks.find((d) => d.id === view.deckEl!.value) || null);
}

function cycleSelectedDeck(direction: 1 | -1) {
	if (!view.deckEl || availableDecks.length < 2) return;
	const currentIndex = Math.max(0, availableDecks.findIndex((deck) => deck.id === view.deckEl!.value));
	const nextIndex = (currentIndex + direction + availableDecks.length) % availableDecks.length;
	view.deckEl.value = availableDecks[nextIndex].id;
	syncSelectedDeckFromUI();
}

function sendSelectedDeckReady() {
	if (!room || !selectedDeck) return false;
	room.send("choose_deck", { deckId: selectedDeck.id, leaderId: selectedDeck.leaderName, cards: selectedDeck.cards, accessories: selectedDeck.accessories || {} });
	room.send("choose_leader", { leaderId: selectedDeck.leaderName });
	room.send("ready", { ready: true });
	return true;
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

function watchMatch(matchRoomId: string) {
	const endpoint = view.endpointEl?.value.trim() || resolveServerEndpoint(window.location.search);
	window.location.href = `./game.html?roomId=${encodeURIComponent(matchRoomId)}&endpoint=${encodeURIComponent(endpoint)}&spectator=1`;
}

function renderMatchList(matches: Array<{ roomId: string; spectatorRoomId?: string; clients: number; maxClients: number; metadata?: { title?: string; p1Name?: string; p2Name?: string; p1LeaderId?: string; p2LeaderId?: string } }>) {
	renderMatches(matches, selectedMatchRoomId, (roomId) => {
		selectedMatchRoomId = roomId;
		renderMatchList(matches);
	}, (roomId) => {
		selectedMatchRoomId = roomId;
		watchMatch(roomId);
	});
	if (!matches.length) selectedMatchRoomId = null;
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

async function refreshMatches() {
	if (!view.endpointEl) return;
	const base = endpointToHttpBase(view.endpointEl.value.trim());
	try {
		const resp = await fetch(`${base}/matches`);
		if (!resp.ok) throw new Error(`status_${resp.status}`);
		const data = await resp.json();
		renderMatchList(Array.isArray(data?.rooms) ? data.rooms : []);
	} catch (error) {
		log("MATCH_LIST_ERROR", { base, error: String(error) });
	}
}

function startRoomPolling() {
	if (roomPollTimer) window.clearInterval(roomPollTimer);
	void refreshRooms();
	void refreshMatches();
	roomPollTimer = window.setInterval(() => {
		void refreshRooms();
		void refreshMatches();
	}, 3000);
}

async function joinLobby(forceCreate = false): Promise<boolean> {
	if (isJoining || !view.endpointEl || !view.roomIdEl) return false;
	isJoining = true;
	try {
		const requestedRoomId = view.roomIdEl.value.trim() || undefined;
		if (room && roomId && requestedRoomId && roomId !== requestedRoomId) {
			await leaveCurrentLobby();
		}
		log("JOINING", { endpoint: view.endpointEl.value.trim(), roomId: requestedRoomId || "(fila automática)" });
		client = await connectClient(view.endpointEl.value.trim());
		room = await joinOrCreateLobby(client, requestedRoomId, forceCreate);
		roomId = room.id;
		selectedRoomId = room.id;
		view.roomIdEl.value = room.id;
		if (view.roomIdViewEl) view.roomIdViewEl.textContent = room.id;

		room.send("set_name", { name: getDisplayName(), avatarId: getAvatarId() });

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
				const joinToken = String(msg?.joinToken || "").trim();
				if (matchRoomId) {
					window.location.href = `./game.html?roomId=${encodeURIComponent(matchRoomId)}&endpoint=${encodeURIComponent(endpoint)}&joinToken=${encodeURIComponent(joinToken)}`;
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

async function privateCodeExists(code: string) {
	if (!view.endpointEl) return false;
	const base = endpointToHttpBase(view.endpointEl.value.trim());
	const resp = await fetch(`${base}/private-lobbies/${encodeURIComponent(code)}`);
	if (!resp.ok) throw new Error(`status_${resp.status}`);
	const data = await resp.json();
	return !!data?.exists;
}

async function enterPrivateLobby(mode: "create" | "join") {
	if (isJoining || !view.endpointEl) return;
	const code = setPrivateCode(view.privateCodeEl?.value || (mode === "create" ? generatePrivateCode() : ""));
	if (!code) {
		log("ERROR", { text: "Digite um código para entrar em sala privada." });
		return;
	}

	isJoining = true;
	try {
		if (room) await leaveCurrentLobby();
		client = await connectClient(view.endpointEl.value.trim());
		if (mode === "create") {
			if (await privateCodeExists(code)) {
				log("ERROR", { text: "Esse código privado já está em uso. Escolha outro ou entre por código.", code });
				return;
			}
			room = await createPrivateLobby(client, code);
		} else {
			room = await joinPrivateLobby(client, code);
		}

		roomId = room.id;
		selectedRoomId = room.id;
		if (view.roomIdEl) view.roomIdEl.value = room.id;
		if (view.roomIdViewEl) view.roomIdViewEl.textContent = room.id;
		setPrivateCode(code);

		const displayName = getDisplayName();
		if (displayName) room.send("set_name", { name: displayName });

		bindLobbyHandlers(room, {
			onAssignSlot: (msg) => {
				mySlot = msg?.slot || null;
				setSlotPhase(mySlot, view.phaseEl?.textContent || "—");
				log("ASSIGN_SLOT", msg);
			},
			onLobbyState: (msg) => {
				setSlotPhase(mySlot, String(msg?.phase || "—"));
				renderPlayers(Array.isArray(msg?.players) ? msg.players : [], mySlot);
				const me = Array.isArray(msg?.players) ? msg.players.find((p: any) => p.slot === mySlot) : null;
				if (view.slotEl) view.slotEl.textContent = me?.displayName ? `${me.displayName} (${mySlot || me.slot || "—"})` : (mySlot || "—");
				myServerReady = !!me?.ready;
				setReadyUI(myServerReady);
			},
			onStartMatch: (msg) => {
				log("START_MATCH", msg);
				const endpoint = view.endpointEl?.value.trim() || resolveServerEndpoint(window.location.search);
				const matchRoomId = String(msg?.matchRoomId || "").trim();
				const joinToken = String(msg?.joinToken || "").trim();
				if (matchRoomId) window.location.href = `./game.html?roomId=${encodeURIComponent(matchRoomId)}&endpoint=${encodeURIComponent(endpoint)}&joinToken=${encodeURIComponent(joinToken)}`;
			},
			onError: (msg) => log("ERROR", msg),
			onLeave: (code) => {
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
		if (sendSelectedDeckReady()) {
			log("READY_SENT", { ready: true, mode: "private" });
		} else {
			log("PRIVATE_WAITING_DECK", { text: "Selecione um deck salvo para ficar pronto na sala privada." });
		}
		log(mode === "create" ? "PRIVATE_CREATED" : "PRIVATE_JOINED", { code, roomId: room.id });
	} catch (error) {
		log("JOIN_ERROR", { text: mode === "create" ? "Não foi possível criar sala privada." : "Código privado não encontrado ou sala cheia.", code, error: String(error) });
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
if (view.privateCodeEl) {
	view.privateCodeEl.oninput = () => setPrivateCode(view.privateCodeEl?.value || "");
}
if (view.btnCreatePrivate) view.btnCreatePrivate.onclick = () => void enterPrivateLobby("create");
if (view.btnJoinPrivate) view.btnJoinPrivate.onclick = () => void enterPrivateLobby("join");
if (view.btnCopyPrivateCode) view.btnCopyPrivateCode.onclick = () => void copyPrivateCode();
if (view.btnSharePrivateCode) view.btnSharePrivateCode.onclick = () => void sharePrivateCode();
if (view.deckEl) view.deckEl.onchange = syncSelectedDeckFromUI;
if (view.btnPreviousDeck) view.btnPreviousDeck.onclick = () => cycleSelectedDeck(-1);
if (view.btnNextDeck) view.btnNextDeck.onclick = () => cycleSelectedDeck(1);
if (view.btnOpenDeckBuilder) view.btnOpenDeckBuilder.onclick = () => { window.location.href = "./ui/deckbuilder.html"; };
if (view.btnEditActiveDeck) view.btnEditActiveDeck.onclick = () => {
	const deckToEdit = selectedDeck || availableDecks.find((deck) => deck.id === view.deckEl?.value);
	if (!deckToEdit) {
		window.location.href = "./ui/deckbuilder.html";
		return;
	}
	try {
		localStorage.setItem("mytragor_deck_edit_draft", JSON.stringify({ mode: "edit", deck: deckToEdit }));
	} catch {
		// The deckbuilder remains available even if storage cannot be updated.
	}
	window.location.href = "./ui/deckbuilder.html?edit=1";
};
window.addEventListener("storage", (event) => {
	if (event.key && event.key !== "mytragor_decks" && event.key !== "mytragor_play_deck") return;
	void refreshSavedDecks();
});
window.addEventListener("focus", () => void refreshSavedDecks());
document.addEventListener("visibilitychange", () => {
	if (!document.hidden) void refreshSavedDecks();
});
if (view.btnRefreshRooms) view.btnRefreshRooms.onclick = () => void refreshRooms();
if (view.btnRefreshMatches) view.btnRefreshMatches.onclick = () => void refreshMatches();
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
				log("ERROR", { text: "Não foi possível entrar na fila para marcar Ready." });
				return;
			}
		}
		const nextReady = !myServerReady;
		if (nextReady && !selectedDeck) {
			log("ERROR", { text: "Selecione um deck salvo antes de ficar pronto." });
			return;
		}
		if (nextReady && selectedDeck) {
			sendSelectedDeckReady();
		} else {
			room?.send("ready", { ready: nextReady });
		}
		log("READY_SENT", { ready: nextReady });
	};
}

const params = new URLSearchParams(window.location.search);
pendingDeckId = params.get("deckId")?.trim() || null;
if (view.endpointEl) view.endpointEl.value = params.get("endpoint")?.trim() || resolveServerEndpoint(window.location.search);
if (view.roomIdEl) view.roomIdEl.value = params.get("roomId")?.trim() || "";

renderDeckSelector();
void refreshSavedDecks();
startRoomPolling();
if (view.roomIdEl?.value) void joinLobby();
