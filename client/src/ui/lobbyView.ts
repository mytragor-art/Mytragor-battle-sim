/* Responsibility: DOM-only helpers for lobby screen. No Colyseus/network code here. */

type Slot = "p1" | "p2" | null;

type LobbyPlayer = { slot: string; displayName?: string; deckId?: string; leaderId?: string; ready?: boolean };
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

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

export function getLobbyInputs() {
	return {
		endpointEl: byId<HTMLInputElement>("endpoint"),
		roomIdEl: byId<HTMLInputElement>("roomId"),
		deckEl: byId<HTMLSelectElement>("deck"),
		leaderEl: byId<HTMLSelectElement>("leader"),
		btnJoin: byId<HTMLButtonElement>("btnJoin"),
		btnReady: byId<HTMLButtonElement>("btnReady"),
		btnRefreshRooms: byId<HTMLButtonElement>("btnRefreshRooms"),
		btnJoinSelected: byId<HTMLButtonElement>("btnJoinSelected"),
		slotEl: byId("slot"),
		phaseEl: byId("phase"),
		roomIdViewEl: byId("roomIdView"),
		readyEl: byId("ready") || byId("readyStatus"),
		leaderViewEl: byId("leaderView"),
		deckCardsCountEl: byId("deckCardsCount"),
		playersEl: byId("players"),
		roomListEl: byId("roomList"),
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
	const readyEl = byId("ready") || byId("readyStatus");
	if (!readyEl) return;
	readyEl.textContent = isReady ? "PRONTO" : "NÃO PRONTO";
	readyEl.className = isReady ? "ok" : "bad";
}

export function renderPlayers(players: LobbyPlayer[], mySlot: Slot = null) {
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
						<div class="playerName">${perspective}: aguardando jogador...</div>
						<div class="playerSlot">${slot}</div>
						<span class="statusBadge wait">ESPERANDO</span>
					</div>
					<div class="playerMeta">
						<div class="metaLine"><span class="metaKey">Deck</span><span class="metaVal">-</span></div>
						<div class="metaLine"><span class="metaKey">Líder</span><span class="metaVal">-</span></div>
					</div>
				</article>
			`;
		}

		const statusClass = player.ready ? "ok" : "wait";
		const statusText = player.ready ? "PRONTO" : "ESPERANDO";
		const label = player.displayName ? `${perspective}: ${player.displayName}` : perspective;

		return `
			<article class="playerCard" data-slot="${slot}">
				<div class="playerTop">
					<div class="playerName">${label}</div>
					<div class="playerSlot">${slot}</div>
					<span class="statusBadge ${statusClass}">${statusText}</span>
				</div>
				<div class="playerMeta">
					<div class="metaLine"><span class="metaKey">Deck</span><span class="metaVal">${player.deckId || "-"}</span></div>
					<div class="metaLine"><span class="metaKey">Líder</span><span class="metaVal">${player.leaderId || "-"}</span></div>
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
		empty.textContent = "Nenhuma sala aberta no momento.";
		empty.className = "roomEmpty";
		roomListEl.appendChild(empty);
		return;
	}

	for (const roomInfo of rooms) {
		const title = String(roomInfo.metadata?.title || "").trim() || truncateRoomId(roomInfo.roomId);
		const subParts = [roomInfo.metadata?.deckName, roomInfo.metadata?.leaderId].filter(Boolean);
		const subtitle = subParts.length ? subParts.join(" • ") : `Sala ${truncateRoomId(roomInfo.roomId)}`;
		const row = document.createElement("div");
		row.className = `roomRow${selectedRoomId === roomInfo.roomId ? " selected" : ""}`;
		row.innerHTML = `
			<span class="roomMain">
				<span class="roomTitle">${title}</span>
				<span class="roomSub">${subtitle}</span>
			</span>
			<span class="roomRight">
				<span class="roomPill">${roomInfo.clients}/${roomInfo.maxClients}</span>
				<button type="button" class="btnGold roomEnterBtn">ENTRAR</button>
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

export function log(msg: string, obj?: unknown) {
	const logEl = byId("log");
	if (!logEl) return;
	const line = `[${new Date().toLocaleTimeString()}] ${msg} ${obj ? JSON.stringify(obj) : ""}\n`;
	logEl.textContent = (line + (logEl.textContent || "")).slice(0, 8000);
}
