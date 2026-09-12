/* Responsibility: DOM-only helpers for lobby screen. No Colyseus/network code here. */
const byId = (id) => document.getElementById(id);
const AVATAR_PATHS = {
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
        endpointEl: byId("endpoint"),
        roomIdEl: byId("roomId"),
        deckEl: byId("deck"),
        leaderEl: byId("leader"),
        activeDeckNameEl: byId("activeDeckName"),
        activeDeckLeaderEl: byId("activeDeckLeader"),
        activeDeckCardsEl: byId("activeDeckCards"),
        activeDeckFragmentArtEl: byId("activeDeckFragmentArt"),
        activeDeckFragmentLabelEl: byId("activeDeckFragmentLabel"),
        activeDeckLeaderArtEl: byId("activeDeckLeaderArt"),
        btnPreviousDeck: byId("btnPreviousDeck"),
        btnNextDeck: byId("btnNextDeck"),
        btnEditActiveDeck: byId("btnEditActiveDeck"),
        btnOpenDeckBuilder: byId("btnOpenDeckBuilder"),
        privateCodeEl: byId("privateCode"),
        btnJoin: byId("btnJoin"),
        btnReady: byId("btnReady"),
        btnCreatePrivate: byId("btnCreatePrivate"),
        btnJoinPrivate: byId("btnJoinPrivate"),
        btnCopyPrivateCode: byId("btnCopyPrivateCode"),
        btnSharePrivateCode: byId("btnSharePrivateCode"),
        btnRefreshRooms: byId("btnRefreshRooms"),
        btnRefreshMatches: byId("btnRefreshMatches"),
        btnJoinSelected: byId("btnJoinSelected"),
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
export function setSlotPhase(slot, phase) {
    const slotEl = byId("slot");
    const phaseEl = byId("phase");
    if (slotEl)
        slotEl.textContent = slot ?? "—";
    if (phaseEl)
        phaseEl.textContent = phase || "—";
}
export function setReadyUI(isReady) {
    const readyEl = byId("ready") || byId("readyStatus");
    if (!readyEl)
        return;
    readyEl.textContent = isReady ? "PRONTO" : "NÃO PRONTO";
    readyEl.className = isReady ? "ok" : "bad";
}
export function renderPlayers(players, mySlot = null) {
    const playersEl = byId("players");
    if (!playersEl)
        return;
    const p1 = players.find((p) => p.slot === "p1") || null;
    const p2 = players.find((p) => p.slot === "p2") || null;
    const ordered = mySlot === "p1"
        ? [{ slot: "p1", player: p1 }, { slot: "p2", player: p2 }]
        : mySlot === "p2"
            ? [{ slot: "p2", player: p2 }, { slot: "p1", player: p1 }]
            : [{ slot: "p1", player: p1 }, { slot: "p2", player: p2 }];
    const renderCard = (slot, player) => {
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
function truncateRoomId(roomId) {
    if (roomId.length <= 10)
        return roomId;
    return `${roomId.slice(0, 4)}…${roomId.slice(-4)}`;
}
export function renderRooms(rooms, selectedRoomId, onSelect, onJoin) {
    const roomListEl = byId("roomList");
    if (!roomListEl)
        return;
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
        const joinBtn = row.querySelector(".roomEnterBtn");
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
export function renderMatches(matches, selectedRoomId, onSelect, onWatch) {
    const matchListEl = byId("matchList");
    if (!matchListEl)
        return;
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
        const watchBtn = row.querySelector(".roomEnterBtn");
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
export function log(msg, obj) {
    const logEl = byId("log");
    if (!logEl)
        return;
    const line = `[${new Date().toLocaleTimeString()}] ${msg} ${obj ? JSON.stringify(obj) : ""}\n`;
    logEl.textContent = (line + (logEl.textContent || "")).slice(0, 8000);
}
