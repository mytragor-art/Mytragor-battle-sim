/* Responsibility: DOM-only helpers for lobby screen. No Colyseus/network code here. */
import { resolveLeaderArtwork } from "./deckStore";

type Slot = "p1" | "p2" | null;

type LobbyPlayer = { slot: string; displayName?: string; avatarId?: string; deckId?: string; leaderId?: string; ready?: boolean };
type LobbyRoom = {
	roomId: string;
	clients: number;
	maxClients: number;
	metadata?: {
		title?: string;
		deckName?: string;
		leaderId?: string;
	};
};

type SpectatorMatch = {
	roomId: string;
	spectatorRoomId?: string;
	clients: number;
	maxClients: number;
	metadata?: {
		title?: string;
		p1Name?: string;
		p2Name?: string;
		p1LeaderId?: string;
		p2LeaderId?: string;
	};
};

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

let playableDeck = false;
let joiningLobby = false;
let lobbyReady = false;

export function setLobbyDeckAvailability(valid: boolean) {
	if (!byId("lobbyFeedback")) return;
	playableDeck = valid;
	for (const id of ["btnReady", "btnCreatePrivate", "btnJoinPrivate", "btnJoinSelected"]) {
		const button = byId<HTMLButtonElement>(id);
		if (button) button.disabled = joiningLobby || (!valid && !(id === "btnReady" && lobbyReady));
	}
	const note = byId("deckValidation");
	if (note) note.textContent = valid ? "Baralho disponível para jogar." : "Selecione ou crie um baralho com escolhido e cartas para jogar.";
}

export function setLobbyServerAvailable(available: boolean) {
	const node = byId("connectionStatus");
	if (!node) return;
	node.textContent = available ? "Servidor disponível" : "Servidor indisponível · tentando novamente";
	node.dataset.state = available ? "ok" : "error";
}

function renderDuelPlayers(players: LobbyPlayer[], mySlot: Slot) {
	const mount = byId("players");
	if (!mount || (!byId("lobbyFeedback") && !byId("soloStatus"))) return false;
	const fragment = document.createDocumentFragment();
	const slots = mySlot === "p2" ? ["p2", "p1"] : ["p1", "p2"];
	for (const slot of slots) {
		const player = players.find(entry => entry.slot === slot);
		const article = document.createElement("article");
		article.className = `duelist${player ? "" : " is-empty"}`;
		const image = document.createElement("img");
		image.className = "duelistPortrait";
		image.alt = "Avatar do jogador";
		image.title = "Avatar do jogador";
		image.src = AVATAR_PATHS[player?.avatarId || ""] || "/publicadas/ui/layout-background.ai.thumb.webp";
		image.onerror = () => { image.onerror = null; image.src = "/publicadas/ui/layout-background.ai.thumb.webp"; };
		const info = document.createElement("div");
		const perspective = document.createElement("small");
		perspective.textContent = mySlot ? slot === mySlot ? "Você" : "Oponente" : slot === "p1" ? "Duelista 1" : "Duelista 2";
		const name = document.createElement("strong");
		name.textContent = player ? player.displayName || "Duelista" : "Aguardando jogador";
		const leader = document.createElement("span");
		leader.textContent = player?.leaderId || "Escolhido não selecionado";
		const status = document.createElement("span");
		status.className = `duelistStatus${player?.ready ? " is-ready" : ""}`;
		status.textContent = !player ? "Lugar disponível" : player.ready ? "Pronto para o duelo" : "Preparando baralho";
		const identity = document.createElement("div");
		identity.className = "duelistProfile";
		identity.append(image, name);
		info.append(perspective, identity, leader, status);
		if (player?.leaderId) {
			const chosen = document.createElement("img");
			chosen.className = "duelistChosen";
			chosen.alt = `Escolhido: ${player.leaderId}`;
			chosen.title = `Escolhido: ${player.leaderId}`;
			chosen.src = resolveLeaderArtwork({ leaderName: player.leaderId });
			article.append(chosen);
		} else {
			const placeholder = document.createElement("div");
			placeholder.className = "duelistChosen";
			article.append(placeholder);
		}
		article.append(info);
		fragment.append(article);
	}
	mount.replaceChildren(fragment);
	const readyCount = players.filter(player => player.ready).length;
	const status = byId("duelStatus");
	if (status) status.textContent = !players.length ? "Nenhuma sala conectada" : players.length < 2 ? "Aguardando oponente" : readyCount === 2 ? "Preparando a partida…" : "Aguardando confirmação dos duelistas";
	return true;
}

const AVATAR_PATHS: Record<string, string> = {
	"chosen:valbrak": "/avatars/chosens/valbrak.png",
	"chosen:katsu": "/avatars/chosens/katsu.png",
	"chosen:leafae": "/avatars/chosens/leafae.png",
	"chosen:ademais": "/avatars/chosens/ademais.png",
	"filiacao:arcana": "/avatars/filiaçoes/arcano.png",
	"filiacao:marcial": "/avatars/filiaçoes/marcial.png",
	"filiacao:religioso": "/avatars/filiaçoes/religioso.png",
	"filiacao:sombras": "/avatars/filiaçoes/sombras1.png"
};

export function getLobbyInputs() {
	return {
		endpointEl: byId<HTMLInputElement>("endpoint"),
		roomIdEl: byId<HTMLInputElement>("roomId"),
		deckEl: byId<HTMLSelectElement>("deck"),
		leaderEl: byId<HTMLSelectElement>("leader"),
		activeDeckNameEl: byId("activeDeckName"),
		activeDeckLeaderEl: byId("activeDeckLeader"),
		activeDeckCardsEl: byId("activeDeckCards"),
		activeDeckFragmentArtEl: byId<HTMLImageElement>("activeDeckFragmentArt"),
		activeDeckFragmentLabelEl: byId("activeDeckFragmentLabel"),
		activeDeckLeaderArtEl: byId<HTMLImageElement>("activeDeckLeaderArt"),
		btnPreviousDeck: byId<HTMLButtonElement>("btnPreviousDeck"),
		btnNextDeck: byId<HTMLButtonElement>("btnNextDeck"),
		btnEditActiveDeck: byId<HTMLButtonElement>("btnEditActiveDeck"),
		btnOpenDeckBuilder: byId<HTMLButtonElement>("btnOpenDeckBuilder"),
		privateCodeEl: byId<HTMLInputElement>("privateCode"),
		btnJoin: byId<HTMLButtonElement>("btnJoin"),
		btnReady: byId<HTMLButtonElement>("btnReady"),
		btnCreatePrivate: byId<HTMLButtonElement>("btnCreatePrivate"),
		btnJoinPrivate: byId<HTMLButtonElement>("btnJoinPrivate"),
		btnCopyPrivateCode: byId<HTMLButtonElement>("btnCopyPrivateCode"),
		btnSharePrivateCode: byId<HTMLButtonElement>("btnSharePrivateCode"),
		btnRefreshRooms: byId<HTMLButtonElement>("btnRefreshRooms"),
		btnRefreshMatches: byId<HTMLButtonElement>("btnRefreshMatches"),
		btnJoinSelected: byId<HTMLButtonElement>("btnJoinSelected"),
		slotEl: byId("slot"),
		phaseEl: byId("phase"),
		roomIdViewEl: byId("roomIdView"),
		readyEl: byId("ready") || byId("readyStatus"),
		privateCodeViewEl: byId("privateCodeView"),
		leaderViewEl: byId("leaderView"),
		deckCardsCountEl: byId("deckCardsCount"),
		playersEl: byId("players"),
		roomListEl: byId("roomList"),
		matchListEl: byId("matchList"),
		logEl: byId("log")
	};
}

export function setSlotPhase(slot: Slot, phase: string) {
	const slotEl = byId("slot");
	const phaseEl = byId("phase");
	if (slotEl) slotEl.textContent = slot ?? "—";
	if (phaseEl) phaseEl.textContent = phase || "—";
}

export function setReadyUI(isReady: boolean) {
	lobbyReady = isReady;
	if (byId("lobbyFeedback")) {
		const button = byId<HTMLButtonElement>("btnReady");
		if (button) button.textContent = isReady ? "Cancelar pronto" : "Entrar na fila";
		setLobbyDeckAvailability(playableDeck);
	}
	const readyEl = byId("ready") || byId("readyStatus");
	if (!readyEl) return;
	readyEl.textContent = isReady ? "PRONTO" : "NÃO PRONTO";
	readyEl.className = isReady ? "ok" : "bad";
}

export function renderPlayers(players: LobbyPlayer[], mySlot: Slot = null) {
	if (renderDuelPlayers(players, mySlot)) return;
	const playersEl = byId("players");
	if (!playersEl) return;

	const p1 = players.find((p) => p.slot === "p1") || null;
	const p2 = players.find((p) => p.slot === "p2") || null;
	const ordered = mySlot === "p1"
		? [{ slot: "p1" as const, player: p1 }, { slot: "p2" as const, player: p2 }]
		: mySlot === "p2"
			? [{ slot: "p2" as const, player: p2 }, { slot: "p1" as const, player: p1 }]
			: [{ slot: "p1" as const, player: p1 }, { slot: "p2" as const, player: p2 }];

	const renderCard = (slot: "p1" | "p2", player: LobbyPlayer | null) => {
		const perspective = mySlot ? (slot === mySlot ? "Você" : "Oponente") : slot;
		if (!player) {
			return `
				<article class="playerCard is-empty" data-slot="${slot}">
					<div class="playerTop">
						<div class="playerIdentity">
							<div class="playerName">${perspective}</div>
							<div class="playerSlot">${slot}</div>
						</div>
						<span class="statusBadge wait">Esperando</span>
					</div>
					<div class="playerMeta playerMetaCompact">
						<span class="metaChip"><span class="metaKey">Nome</span><span class="metaVal">aguardando jogador</span></span>
						<span class="metaChip"><span class="metaKey">Baralho</span><span class="metaVal">-</span></span>
						<span class="metaChip"><span class="metaKey">Líder</span><span class="metaVal">-</span></span>
					</div>
				</article>
			`;
		}

		const statusClass = player.ready ? "ok" : "wait";
		const statusText = player.ready ? "PRONTO" : "ESPERANDO";
		const label = player.displayName ? `${perspective}: ${player.displayName}` : perspective;
		const avatarPath = AVATAR_PATHS[player.avatarId || ""];
		const avatar = avatarPath ? `<img class="playerAvatar" src="${avatarPath}" alt="">` : "";

		return `
			<article class="playerCard" data-slot="${slot}">
				<div class="playerTop">
					<div class="playerIdentity">
						${avatar}
						<div class="playerName">${label}</div>
						<div class="playerSlot">${slot}</div>
					</div>
					<span class="statusBadge ${statusClass}">${statusText === "PRONTO" ? "Pronto" : "Esperando"}</span>
				</div>
				<div class="playerMeta playerMetaCompact">
					<span class="metaChip"><span class="metaKey">Baralho</span><span class="metaVal">${player.deckId || "-"}</span></span>
					<span class="metaChip"><span class="metaKey">Líder</span><span class="metaVal">${player.leaderId || "-"}</span></span>
				</div>
			</article>
		`;
	};

	playersEl.innerHTML = `
		<div class="playersMount">
			${renderCard(ordered[0].slot, ordered[0].player)}
			${renderCard(ordered[1].slot, ordered[1].player)}
		</div>
	`;
}

function truncateRoomId(roomId: string) {
	if (roomId.length <= 10) return roomId;
	return `${roomId.slice(0, 4)}…${roomId.slice(-4)}`;
}

export function renderRooms(
	rooms: LobbyRoom[],
	selectedRoomId: string | null,
	onSelect: (roomId: string) => void,
	onJoin: (roomId: string) => void
) {
	const roomListEl = byId("roomList");
	if (!roomListEl) return;
	roomListEl.innerHTML = "";

	if (!rooms.length) {
		const empty = document.createElement("div");
		empty.textContent = "Nenhuma mesa esperando no momento. A fila cria uma automaticamente.";
		empty.className = "roomEmpty";
		roomListEl.appendChild(empty);
		return;
	}

	for (const roomInfo of rooms) {
		const title = String(roomInfo.metadata?.title || "").trim() || truncateRoomId(roomInfo.roomId);
		const subParts = [roomInfo.metadata?.deckName, roomInfo.metadata?.leaderId].filter(Boolean);
		const subtitle = subParts.length ? subParts.join(" • ") : `Mesa ${truncateRoomId(roomInfo.roomId)}`;
		const row = document.createElement("div");
		row.className = `roomRow${selectedRoomId === roomInfo.roomId ? " selected" : ""}`;
		row.innerHTML = `
			<span class="roomMain">
				<span class="roomTitle">${title}</span>
				<span class="roomSub">${subtitle}</span>
			</span>
			<span class="roomRight">
				<span class="roomPill">${roomInfo.clients}/${roomInfo.maxClients}</span>
				<button type="button" class="btnGold roomEnterBtn">Entrar</button>
			</span>
		`;
		row.onclick = () => onSelect(roomInfo.roomId);

		const joinBtn = row.querySelector(".roomEnterBtn") as HTMLButtonElement | null;
		if (joinBtn) {
			joinBtn.onclick = (event) => {
				event.stopPropagation();
				onSelect(roomInfo.roomId);
				onJoin(roomInfo.roomId);
			};
		}
		roomListEl.appendChild(row);
	}
}

export function renderMatches(
	matches: SpectatorMatch[],
	selectedRoomId: string | null,
	onSelect: (roomId: string) => void,
	onWatch: (roomId: string) => void
) {
	const matchListEl = byId("matchList");
	if (!matchListEl) return;
	matchListEl.innerHTML = "";

	if (!matches.length) {
		const empty = document.createElement("div");
		empty.textContent = "Nenhuma partida em andamento no momento.";
		empty.className = "roomEmpty";
		matchListEl.appendChild(empty);
		return;
	}

	for (const matchInfo of matches) {
		const leftName = String(matchInfo.metadata?.p1Name || "Jogador 1");
		const rightName = String(matchInfo.metadata?.p2Name || "Jogador 2");
		const title = String(matchInfo.metadata?.title || "").trim() || `${leftName} vs ${rightName}`;
		const subParts = [matchInfo.metadata?.p1LeaderId, matchInfo.metadata?.p2LeaderId].filter(Boolean);
		const subtitle = subParts.length ? subParts.join(" • ") : `Partida ${truncateRoomId(matchInfo.roomId)}`;
		const row = document.createElement("div");
		row.className = `roomRow${selectedRoomId === matchInfo.roomId ? " selected" : ""}`;
		row.innerHTML = `
			<span class="roomMain">
				<span class="roomTitle">${title}</span>
				<span class="roomSub">${subtitle}</span>
			</span>
			<span class="roomRight">
				<span class="roomPill">Ao vivo</span>
				<button type="button" class="btnGold roomEnterBtn">Ver</button>
			</span>
		`;
		row.onclick = () => onSelect(matchInfo.roomId);

		const watchBtn = row.querySelector(".roomEnterBtn") as HTMLButtonElement | null;
		if (watchBtn) {
			watchBtn.onclick = (event) => {
				event.stopPropagation();
				onSelect(matchInfo.roomId);
				onWatch(matchInfo.roomId);
			};
		}
		matchListEl.appendChild(row);
	}
}

export function log(msg: string, obj?: unknown) {
	const feedback = byId("lobbyFeedback");
	if (feedback) {
		const data = (obj || {}) as Record<string, unknown>;
		if (msg === "JOINING" || msg === "PRIVATE_CONNECTING") {
			joiningLobby = true;
			feedback.textContent = "Conectando à sala…";
		} else if (["JOINED", "PRIVATE_CREATED", "PRIVATE_JOINED", "ROOM_LEAVE", "JOIN_ERROR", "ERROR"].includes(msg)) {
			joiningLobby = false;
			if (msg === "ROOM_LEAVE") renderDuelPlayers([], null);
			feedback.textContent = msg === "ROOM_LEAVE" ? "Você saiu da sala." : msg === "JOIN_ERROR" || msg === "ERROR" ? String(data.text || "Não foi possível concluir a ação.") : msg === "JOINED" ? "Sala conectada. Confirme para entrar na fila." : "Sala privada conectada. Aguardando oponente.";
		} else if (msg === "READY_SENT") {
			feedback.textContent = data.ready ? "Pronto. Aguardando o outro duelista." : "Pronto cancelado. Você pode trocar seu baralho.";
		} else if (msg === "START_MATCH") feedback.textContent = "Duelo encontrado. Abrindo a partida…";
		else if (msg === "PRIVATE_CODE_COPIED") feedback.textContent = "Código da sala copiado.";
		else if (msg === "PRIVATE_CODE_SHARED") feedback.textContent = "Convite compartilhado.";
		setLobbyDeckAvailability(playableDeck);
	}
	const logEl = byId("log");
	if (!logEl) return;
	const line = `[${new Date().toLocaleTimeString()}] ${msg} ${obj ? JSON.stringify(obj) : ""}\n`;
	logEl.textContent = (line + (logEl.textContent || "")).slice(0, 8000);
}
