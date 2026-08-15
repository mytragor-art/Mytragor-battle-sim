import { bindLobbyHandlers, connectClient, joinOrCreateNamedRoom } from "../net/mp";
import { resolveHttpBase, resolveServerEndpoint } from "../config/runtime";
import { hydrateSavedDecks, readSavedDecks, resolveDeckAssetPath, resolveLeaderArtwork, type SavedDeck } from "../ui/deckStore";
import { getLobbyInputs, log, renderPlayers, renderRooms, setReadyUI, setSlotPhase } from "../ui/lobbyView";
import { getAvatarId, getDisplayName } from "../ui/profile";

const view = getLobbyInputs();

let client: any = null;
let room: any = null;
let mySlot: "p1" | "p2" | null = null;
let roomId: string | null = null;
let myServerReady = false;
let isJoining = false;
let selectedDeck: SavedDeck | null = null;
let selectedBotDeck: SavedDeck | null = null;
let selectedRoomId: string | null = null;
let roomPollTimer: number | null = null;
let availableDecks: SavedDeck[] = readSavedDecks();
let deckRefreshToken = 0;
let selectedMatchRoomId: string | null = null;
let pendingDeckId: string | null = null;

const botDeckEl = document.getElementById("botDeck") as HTMLSelectElement | null;
const botLeaderEl = document.getElementById("botLeader") as HTMLSelectElement | null;
const botDeckNameEl = document.getElementById("botDeckName");
const botDeckLeaderEl = document.getElementById("botDeckLeader");
const botDeckCardsEl = document.getElementById("botDeckCards");
const botDeckLeaderArtEl = document.getElementById("botDeckLeaderArt") as HTMLImageElement | null;

function applySelectedBotDeck(deck: SavedDeck | null) {
	selectedBotDeck = deck;
	if (botLeaderEl) botLeaderEl.value = selectedBotDeck?.leaderName || "";
	if (botDeckNameEl) botDeckNameEl.textContent = selectedBotDeck?.deckName || "Escolha um deck";
	if (botDeckLeaderEl) botDeckLeaderEl.textContent = `Líder: ${selectedBotDeck?.leaderName || "—"}`;
	if (botDeckCardsEl) botDeckCardsEl.textContent = selectedBotDeck ? `${selectedBotDeck.cards.length} cartas` : "— cartas";
	if (botDeckLeaderArtEl) {
		botDeckLeaderArtEl.src = selectedBotDeck ? resolveLeaderArtwork(selectedBotDeck) : "/publicadas/ui/layout-background.ai.thumb.webp";
		botDeckLeaderArtEl.alt = selectedBotDeck ? `Líder da IA: ${selectedBotDeck.leaderName}` : "Líder do deck da IA";
	}
	if (room && selectedBotDeck) {
		room.send("choose_bot_deck", {
			deckId: selectedBotDeck.id,
			leaderId: selectedBotDeck.leaderName,
			cards: selectedBotDeck.cards,
			accessories: selectedBotDeck.accessories || {}
		});
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
		const option = document.createElement("option");
		option.value = deck.id;
		option.textContent = `${deck.deckName} • Líder: ${deck.leaderName}`;
		view.deckEl.appendChild(option);
	}

	const nextDeck = decks.find((deck) => deck.id === selectedId) || (decks.length === 1 ? decks[0] : null);
	view.deckEl.value = nextDeck?.id || "";
	if (nextDeck && pendingDeckId === nextDeck.id) pendingDeckId = null;
	applySelectedDeck(nextDeck);

	if (botDeckEl) {
		const currentBotValue = botDeckEl.value;
		const fallbackBotDeck = decks.find((deck) => deck.id !== nextDeck?.id) || nextDeck || null;
		const nextBotDeck = decks.find((deck) => deck.id === currentBotValue) || selectedBotDeck || fallbackBotDeck;
		botDeckEl.innerHTML = "";
		const botPlaceholder = document.createElement("option");
		botPlaceholder.value = "";
		botPlaceholder.textContent = "(selecione o deck da IA)";
		botDeckEl.appendChild(botPlaceholder);
		for (const deck of decks) {
			const option = document.createElement("option");
			option.value = deck.id;
			option.textContent = `${deck.deckName} • Líder: ${deck.leaderName}`;
			botDeckEl.appendChild(option);
		}
		botDeckEl.value = nextBotDeck?.id || "";
		applySelectedBotDeck(nextBotDeck);
	}
}

function syncSelectedDeckFromUI() {
	if (!view.deckEl) return;
	applySelectedDeck(availableDecks.find((deck) => deck.id === view.deckEl!.value) || null);
}

function cycleSelectedDeck(direction: 1 | -1) {
	if (!view.deckEl || availableDecks.length < 2) return;
	const currentIndex = Math.max(0, availableDecks.findIndex((deck) => deck.id === view.deckEl!.value));
	const nextIndex = (currentIndex + direction + availableDecks.length) % availableDecks.length;
	view.deckEl.value = availableDecks[nextIndex].id;
	syncSelectedDeckFromUI();
}

function syncSelectedBotDeckFromUI() {
	if (!botDeckEl) return;
	applySelectedBotDeck(availableDecks.find((deck) => deck.id === botDeckEl.value) || null);
}

async function refreshSavedDecks() {
	const token = ++deckRefreshToken;
	const decks = await hydrateSavedDecks();
	if (token !== deckRefreshToken) return;
	availableDecks = decks;
	renderDeckSelector();
}

function renderRoomList(rooms: Array<{ roomId: string; clients: number; maxClients: number; metadata?: { title?: string; deckName?: string; leaderId?: string } }>) {
	renderRooms(rooms, selectedRoomId, (nextRoomId) => {
		selectedRoomId = nextRoomId;
		renderRoomList(rooms);
	}, (nextRoomId) => {
		selectedRoomId = nextRoomId;
		if (!view.roomIdEl) return;
		view.roomIdEl.value = nextRoomId;
		if (view.btnJoinSelected) {
			view.btnJoinSelected.click();
			return;
		}
		void joinLobby();
	});
	if (!rooms.length) selectedRoomId = null;
}

function renderMatchList(matches: Array<{ roomId: string; clients: number; maxClients: number; metadata?: { title?: string; p1Name?: string; p2Name?: string; p1LeaderId?: string; p2LeaderId?: string } }>) {
	const matchListEl = view.matchListEl;
	if (!matchListEl) return;
	matchListEl.innerHTML = "";

	if (!matches.length) {
		const empty = document.createElement("div");
		empty.textContent = "Nenhuma partida solo em andamento no momento.";
		empty.className = "roomEmpty";
		matchListEl.appendChild(empty);
		selectedMatchRoomId = null;
		return;
	}

	for (const match of matches) {
		const title = String(match.metadata?.title || "").trim() || "Partida solo";
		const subtitleParts = [match.metadata?.p1LeaderId, match.metadata?.p2LeaderId].filter(Boolean);
		const subtitle = subtitleParts.length ? subtitleParts.join(" • ") : String(match.roomId || "");
		const row = document.createElement("div");
		row.className = `roomRow${selectedMatchRoomId === match.roomId ? " selected" : ""}`;
		row.innerHTML = `
			<span class="roomMain">
				<span class="roomTitle">${title}</span>
				<span class="roomSub">${subtitle}</span>
			</span>
			<span class="roomRight">
				<span class="roomPill">Em andamento</span>
				<button type="button" class="btnGold roomEnterBtn">Ver</button>
			</span>
		`;
		row.onclick = () => {
			selectedMatchRoomId = match.roomId;
			renderMatchList(matches);
		};

		const watchBtn = row.querySelector(".roomEnterBtn") as HTMLButtonElement | null;
		if (watchBtn) {
			watchBtn.onclick = (event) => {
				event.stopPropagation();
				selectedMatchRoomId = match.roomId;
				const endpoint = view.endpointEl?.value.trim() || resolveServerEndpoint(window.location.search);
				window.location.href = `./game.html?roomId=${encodeURIComponent(match.roomId)}&endpoint=${encodeURIComponent(endpoint)}&spectator=1`;
			};
		}
		matchListEl.appendChild(row);
	}
}

async function refreshRooms() {
	if (!view.endpointEl) return;
	const base = endpointToHttpBase(view.endpointEl.value.trim());
	try {
		const response = await fetch(`${base}/solo-lobbies`);
		if (!response.ok) throw new Error(`status_${response.status}`);
		const data = await response.json();
		renderRoomList(Array.isArray(data?.rooms) ? data.rooms : []);
	} catch (error) {
		log("ROOM_LIST_ERROR", { base, error: String(error) });
	}
}

async function refreshMatches() {
	if (!view.endpointEl) return;
	const base = endpointToHttpBase(view.endpointEl.value.trim());
	try {
		const response = await fetch(`${base}/solo-matches`);
		if (!response.ok) throw new Error(`status_${response.status}`);
		const data = await response.json();
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
		log("JOINING", { endpoint: view.endpointEl.value.trim(), roomId: requestedRoomId || "(novo solo)" });
		client = await connectClient(view.endpointEl.value.trim());
		room = await joinOrCreateNamedRoom(client, "solo_lobby", requestedRoomId, forceCreate);
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
				const me = Array.isArray(msg?.players) ? msg.players.find((player: any) => player.slot === mySlot) : null;
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
					window.location.href = `./game.html?roomId=${encodeURIComponent(matchRoomId)}&endpoint=${encodeURIComponent(endpoint)}&joinToken=${encodeURIComponent(joinToken)}&solo=1`;
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
		syncSelectedBotDeckFromUI();
		log("JOINED", { roomId: room.id, mode: "solo" });
		return true;
	} catch (error) {
		log("JOIN_ERROR", { text: view.roomIdEl.value.trim() ? "Não foi possível entrar na sala solo selecionada." : "Não foi possível criar sala solo.", error: String(error) });
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
if (botDeckEl) botDeckEl.onchange = syncSelectedBotDeckFromUI;
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
	} catch {}
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
			const joined = await joinLobby(true);
			if (!joined || !room) {
				log("ERROR", { text: "Não foi possível entrar na sala solo para marcar Ready." });
				return;
			}
		}
		const nextReady = !myServerReady;
		if (nextReady && !selectedDeck) {
			log("ERROR", { text: "Selecione um deck salvo antes de iniciar desafio solo." });
			return;
		}
		if (nextReady && !selectedBotDeck) {
			log("ERROR", { text: "Selecione também o deck que a IA vai jogar." });
			return;
		}
		if (nextReady && selectedDeck) {
			room?.send("choose_deck", { deckId: selectedDeck.id, leaderId: selectedDeck.leaderName, cards: selectedDeck.cards, accessories: selectedDeck.accessories || {} });
			room?.send("choose_leader", { leaderId: selectedDeck.leaderName });
		}
		if (nextReady && selectedBotDeck) {
			room?.send("choose_bot_deck", { deckId: selectedBotDeck.id, leaderId: selectedBotDeck.leaderName, cards: selectedBotDeck.cards, accessories: selectedBotDeck.accessories || {} });
		}
		room?.send("ready", { ready: nextReady });
		log("READY_SENT", { ready: nextReady, mode: "solo" });
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