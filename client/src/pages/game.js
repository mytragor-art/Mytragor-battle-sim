/* Responsibility: wire Match UI with Colyseus network. This is the only place combining UI + NET. */
import { bindMatchHandlers, connectClient, joinMatchById, resolveSpectatorRoomId } from "../net/mp";
import { animateCardTransfer, animateEl, bindAttackTargetHover, setChosenReady, setupAttackArrow, startAttackArrow, stopAttackArrow } from "../animations/animationHelpers";
import { getGameInputs, log, logText, renderButtonRow } from "../ui/gameView";
import { setupBoardScale } from "../ui/boardScale";
import { setupArenaSlots } from "../ui/arenaSlots";
import { getAvatarId, getDisplayName } from "../ui/profile";
import { createMobileCardInspect } from "../ui/mobileCardInspect";
import { renderCardRulesText } from "../ui/cardRulesText";
import { resolveHttpBase, resolveServerEndpoint } from "../config/runtime";
import { canAttackCardQuiet, canAttackTargetQuiet, endAttackCleanup, resolveAttackOn, selectAttacker } from "../game/battle";
const view = getGameInputs();
setupBoardScale();
setupArenaSlots();
setupAttackArrow();
setupMobilePreviewToggle();
const mobileCardInspect = createMobileCardInspect();
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
const previousLaneCards = {
    "you-field": [],
    "ai-field": [],
    "you-support": [],
    "ai-support": []
};
const pendingLanePileFlights = {
    "you-field": new Map(),
    "ai-field": new Map(),
    "you-support": new Map(),
    "ai-support": new Map()
};
const previousHandCards = {
    "youHand": [],
    "aiHand": []
};
const cardDefs = window.CARD_DEFS ?? [];
const cardLookup = new Map();
const CARD_BACK_ASSET = "ui/layout-background.ai.png";
const ASSET_CACHE_VERSION = "2026-05-17-2";
const MULLIGAN_TIMEOUT_MS = 40000;
const MATCH_RECONNECT_MAX_ATTEMPTS = 15;
const MOBILE_PREVIEW_FAB_POSITION_KEY = "mytragor_mobile_preview_fab_position";
const SLEEVE_ASSET_BY_KEY = {
    "sleeve-arcano": "/assets/acessorios/sleeve/sleeve Arcano.png",
    "sleeve-marcial": "/assets/acessorios/sleeve/sleeve Marcial.png",
    "sleeve-religioso": "/assets/acessorios/sleeve/sleeve religioso.png",
    "sleeve-sombras": "/assets/acessorios/sleeve/sleeve sombras.png"
};
const PLAYMAT_ASSET_BY_KEY = {
    "mytragor-classic": "/assets/playmat/playmat-base.png",
    "playmat-executor": "/assets/acessorios/playmat/playmat executor.png",
    "playmat-leao-rei-sagrado": "/assets/acessorios/playmat/playmat leão rei sagrado.png",
    "playmat-livro-arcano": "/assets/acessorios/playmat/playmat livro arcano.png",
    "playmat-sede-de-vinganca": "/assets/acessorios/playmat/playmat sede de vingança.png"
};
function resolveSleeveAsset(sleeveKey) {
    return SLEEVE_ASSET_BY_KEY[String(sleeveKey || "").trim()] || CARD_BACK_ASSET;
}
function cardBackAssetForSide(side) {
    return side === "you" ? resolveSleeveAsset(currentMySleeve) : resolveSleeveAsset(currentEnemySleeve);
}
function resolvePlaymatBackground(playmatKey) {
    const normalized = String(playmatKey || "").trim();
    if (normalized === "no-playmat")
        return "none";
    const asset = PLAYMAT_ASSET_BY_KEY[normalized] || PLAYMAT_ASSET_BY_KEY["mytragor-classic"];
    return `url('${asset}')`;
}
function applyArenaPlaymats() {
    const myArena = document.getElementById("youArena");
    const enemyArena = document.getElementById("opArena");
    if (myArena)
        myArena.style.setProperty("--arena-playmat", resolvePlaymatBackground(currentMyPlaymat));
    if (enemyArena)
        enemyArena.style.setProperty("--arena-playmat", resolvePlaymatBackground(currentEnemyPlaymat));
}
function envAliasesForCard(card) {
    const normalizedName = normalizeCardId(String(card?.name || ""));
    if (normalizedName === "tempestadearcana")
        return ["tempestadearcana", "tempestadearcanaenv"];
    if (normalizedName === "camposensanguentados")
        return ["camposensanguentados", "campoensanguentado", "camposbg"];
    if (normalizedName === "caminhodassombras")
        return ["caminhosdassombras", "caminhodassombras"];
    if (normalizedName === "catedralensolarada")
        return ["catedralensolarada"];
    return [];
}
for (const card of cardDefs) {
    if (!card?.name)
        continue;
    const imgRaw = String(card.img || "");
    const imgClean = pathNoAssetsPrefix(imgRaw);
    const imgFile = imgRaw.split("/").pop() || "";
    const imgBase = imgFile.replace(/\.[a-z]+$/i, "");
    const imgStem = basenameCardKey(imgRaw);
    const keys = [
        card.name,
        card.key || "",
        ...(Array.isArray(card.aliases) ? card.aliases : []),
        imgBase,
        imgStem,
        basenameNoExt(imgClean),
        basenameCardKey(imgClean),
        imgFile,
        imgRaw,
        imgClean,
        `/${imgRaw}`,
        `/${imgClean}`,
        ...envAliasesForCard(card)
    ];
    for (const key of keys) {
        const normalized = normalizeCardId(key);
        if (normalized && !cardLookup.has(normalized))
            cardLookup.set(normalized, card);
    }
}
let client = null;
let room = null;
let slot = null;
let roomId = null;
let selfSessionId = null;
let isSpectator = false;
let spectatorMatchRoomId = null;
let spectatorReconnectAttempts = 0;
let spectatorReconnectTimer = null;
let matchReconnectAttempts = 0;
let matchReconnectTimer = null;
let reconnectOverlayHideTimer = null;
let matchReconnectionToken = "";
let selectedHandCardId = null;
let selectedInspectorView = null;
let hoveredInspectorView = null;
let selectedAttackerPos = null;
let selectedTargetType = "leader";
let selectedTargetPos = null;
let pendingAttackConfirmPos = null;
let isJoining = false;
let currentPhase = "INITIAL";
let isMatchFinished = false;
let isMyTurn = false;
let currentMyField = [];
let currentMyFieldHp = [];
let currentMyFieldAtkTemp = [];
let currentMyFieldAtkPerm = [];
let currentMyFieldAcPerm = [];
let currentMyFieldBlessing = [];
let currentMyFieldBloodMarks = [];
let currentMyFieldVitalMarks = [];
let currentEnemyField = [];
let currentEnemyFieldHp = [];
let currentEnemyFieldAtkTemp = [];
let currentEnemyFieldAtkPerm = [];
let currentEnemyFieldAcPerm = [];
let currentEnemyFieldBlessing = [];
let currentEnemyFieldBloodMarks = [];
let currentEnemyFieldVitalMarks = [];
let currentMySupport = [];
let currentEnemySupport = [];
let currentMySupportAttach = [];
let currentEnemySupportAttach = [];
let currentMySupportCounters = [];
let currentEnemySupportCounters = [];
let currentMyEnv = null;
let currentEnemyEnv = null;
let currentMyLeader = "";
let currentEnemyLeader = "";
let currentMyLeaderTapped = false;
let currentEnemyLeaderTapped = false;
let currentMyLeaderHp = 0;
let currentEnemyLeaderHp = 0;
let currentMyLeaderBlessing = 0;
let currentEnemyLeaderBlessing = 0;
let currentMyLeaderVitalMarks = 0;
let currentEnemyLeaderVitalMarks = 0;
let currentMyLeaderSpiderMarks = 0;
let currentEnemyLeaderSpiderMarks = 0;
let currentMySleeve = "";
let currentEnemySleeve = "";
let currentMyPlaymat = "";
let currentEnemyPlaymat = "";
let currentMyFragments = 0;
let currentEnemyFragments = 0;
let currentMyHand = [];
let currentMyDeck = [];
let currentEnemyDeck = [];
let currentMyGrave = [];
let currentEnemyGrave = [];
let currentMyBanished = [];
let currentEnemyBanished = [];
let mulliganSubmitted = false;
const mulliganSelectedIndexes = new Set();
let activeMulliganTimer = null;
let currentMulliganDeadlineAt = 0;
let activeChoiceId = null;
let activeChoiceTimer = null;
let activeWaitingTimer = null;
let activeChoiceHighlightedElements = [];
let activeChoiceIsMinimized = false;
let activeChoiceTitleText = "Escolha pendente";
let activePileSide = "you";
let activePileWhich = "deck";
let myTurnCount = 0;
let enemyTurnCount = 0;
let lastTurnMarker = "";
let lastMatchEndSeq = -1;
let revealHideTimer = null;
const clientDiagnosticRunId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let clientDiagnosticLastTick = performance.now();
let clientDiagnosticMaxFrameGapMs = 0;
let clientDiagnosticLastHeartbeatAt = 0;
function reportClientDiagnostic(event, detail = "", closeCode) {
    if (!roomId || !selfSessionId)
        return;
    const endpoint = view.endpointEl?.value.trim() || resolveServerEndpoint(window.location.search);
    const memory = performance.memory;
    const payload = {
        roomId,
        sessionId: selfSessionId,
        runId: clientDiagnosticRunId,
        event,
        clientTimestamp: Date.now(),
        visibility: document.visibilityState,
        online: navigator.onLine,
        domNodes: document.getElementsByTagName("*").length,
        heapMb: Number.isFinite(Number(memory?.usedJSHeapSize)) ? Math.round(Number(memory?.usedJSHeapSize) / 1024 / 1024) : null,
        frameGapMs: Math.round(clientDiagnosticMaxFrameGapMs),
        closeCode: Number.isFinite(Number(closeCode)) ? Number(closeCode) : null,
        detail
    };
    void fetch(`${resolveHttpBase(endpoint)}/client-diagnostics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
    }).catch(() => { });
}
window.setInterval(() => {
    const now = performance.now();
    const frameGapMs = Math.max(0, now - clientDiagnosticLastTick - 1000);
    clientDiagnosticLastTick = now;
    clientDiagnosticMaxFrameGapMs = Math.max(clientDiagnosticMaxFrameGapMs, frameGapMs);
    if (frameGapMs >= 4000)
        reportClientDiagnostic("main_thread_stall", `gap=${Math.round(frameGapMs)}ms`);
    if (Date.now() - clientDiagnosticLastHeartbeatAt >= 10000) {
        clientDiagnosticLastHeartbeatAt = Date.now();
        reportClientDiagnostic("heartbeat");
        clientDiagnosticMaxFrameGapMs = 0;
    }
}, 1000);
window.addEventListener("pagehide", () => reportClientDiagnostic("pagehide"));
window.addEventListener("offline", () => reportClientDiagnostic("offline"));
window.addEventListener("online", () => reportClientDiagnostic("online"));
document.addEventListener("visibilitychange", () => reportClientDiagnostic(`visibility_${document.visibilityState}`));
window.addEventListener("error", (event) => reportClientDiagnostic("window_error", event.message || "unknown error"));
window.addEventListener("unhandledrejection", (event) => reportClientDiagnostic("unhandled_rejection", String(event.reason || "unknown rejection")));
function animateChosenPowerActivation(side) {
    const leaderSlotId = side === "you" ? "you-leader" : "ai-leader";
    animateEl(document.querySelector(`#${leaderSlotId} > .card`), "anim-power");
    if (side === "you")
        animateEl(view.btnLeaderPower, "anim-power");
}
function animatePileEntryIfNeeded(slotId, previousCards, nextCards) {
    if (nextCards.length <= previousCards.length)
        return;
    const slotEl = document.getElementById(slotId);
    if (!slotEl)
        return;
    animateEl(slotEl.querySelector(":scope > .deckVisualCard:last-of-type"), "anim-pile-in");
    animateEl(slotEl.querySelector(":scope > .slotCount"), "anim-pile-in");
}
const tappedBySide = {
    you: new Set(),
    ai: new Set()
};
const tappedLeaderBySide = {
    you: false,
    ai: false
};
const untapPulseBySide = {
    you: false,
    ai: false
};
const justUntappedBySide = {
    you: new Set(),
    ai: new Set()
};
const justUntappedLeaderBySide = {
    you: false,
    ai: false
};
const publicPlayerNames = {
    p1: "Jogador 1",
    p2: "Jogador 2"
};
const summonedBySide = {
    you: new Set(),
    ai: new Set()
};
function sideFromServerSlot(serverSlot) {
    if (!slot || !serverSlot)
        return null;
    if (serverSlot === slot)
        return "you";
    return "ai";
}
function currentBattlePhase() {
    return String(currentPhase || "INITIAL").toUpperCase() === "COMBAT" ? "battle" : "other";
}
function ownerLabel(serverSlotRaw) {
    if (isSpectator)
        return serverSlotRaw === "p2" ? publicPlayerNames.p2 : publicPlayerNames.p1;
    const side = sideFromServerSlot((serverSlotRaw || ""));
    return side === "you" ? "Você" : "Oponente";
}
function cardHasFiliation(cardId, expected) {
    const card = resolveCard(cardId);
    const probe = normalizeKind(expected);
    const source = normalizeKind(`${String(card?.filiacao || "")} ${String(card?.classe || "")}`);
    return !!probe && source.includes(probe);
}
function isShadowPenaltyEnvCard(cardId) {
    const card = resolveCard(String(cardId || ""));
    if (String(card?.effect || "") === "sombra_penalty")
        return true;
    const normalized = normalizeCardId(String(card?.name || cardId || ""));
    return normalized === "caminhodassombras" || normalized === "caminhosdassombras" || normalized === "caminhosperigosos";
}
function hasShadowPenaltyForPlayer(playerState, leaderId, ownEnv, enemyEnv) {
    if (!isShadowPenaltyEnvCard(ownEnv) && !isShadowPenaltyEnvCard(enemyEnv))
        return false;
    if (cardHasFiliation(leaderId, "Sombras"))
        return false;
    return !normalizeKind(String(playerState?.filiacao || "")).includes("sombras");
}
function victoryBannerForLeader(mode) {
    if (mode !== "win")
        return null;
    const leader = resolveCard(currentMyLeader);
    const probes = [
        currentMyLeader,
        String(leader?.name || ""),
        String(leader?.img || ""),
        basenameCardKey(String(leader?.img || ""))
    ]
        .map((value) => normalizeCardId(value))
        .filter(Boolean);
    if (probes.some((value) => value.includes("valbrak"))) {
        return { src: "win_lose/valbrakvitoria.png", credit: "Ilustração de IlustreVick" };
    }
    if (probes.some((value) => value.includes("katsu"))) {
        return { src: "win_lose/katsuvitoria.png", credit: "Ilustração de Artur Broher" };
    }
    if (probes.some((value) => value.includes("leafae"))) {
        return { src: "win_lose/leafaevitoria.png", credit: "Ilustração de Katarina Banffy" };
    }
    if (probes.some((value) => value.includes("ademais"))) {
        return { src: "win_lose/Ademaisvitoria.jpg", credit: "Ilustração de Jeferson Cordeiro" };
    }
    return null;
}
function describeMatchEnded(msg) {
    const winnerSlot = String(msg?.winner || "");
    const loserSlot = String(msg?.loser || "");
    const reason = String(msg?.reason || "hp_zero");
    const winner = ownerLabel(winnerSlot);
    if (isSpectator) {
        if (reason === "deckout")
            return { title: "Fim de jogo", text: `${winner} venceu porque o adversário tentou comprar carta com o deck vazio.`, mode: "neutral" };
        if (reason === "inactivity")
            return { title: "Fim de jogo", text: `${winner} venceu por inatividade do adversário.`, mode: "neutral" };
        if (reason === "opponent_left")
            return { title: "Fim de jogo", text: `${winner} venceu porque o adversário saiu da sala.`, mode: "neutral" };
        if (reason === "concede")
            return { title: "Fim de jogo", text: `${winner} venceu porque o adversário concedeu a partida.`, mode: "neutral" };
        return { title: "Fim de jogo", text: `${winner} venceu ao reduzir a vida do Escolhido adversário a zero.`, mode: "neutral" };
    }
    const youWon = !!slot && winnerSlot === slot;
    const youLost = !!slot && loserSlot === slot;
    const title = youWon ? "Você ganhou" : youLost ? "Você perdeu" : "Fim de jogo";
    if (reason === "deckout") {
        if (youWon)
            return { title, text: "Você ganhou porque o oponente tentou comprar carta com o deck vazio.", mode: "win" };
        if (youLost)
            return { title, text: "Você perdeu porque tentou comprar carta com o deck vazio.", mode: "lose" };
        return { title, text: "A partida terminou por deck vazio.", mode: "neutral" };
    }
    if (reason === "inactivity") {
        if (youWon)
            return { title, text: "Você ganhou por inatividade do oponente.", mode: "win" };
        if (youLost)
            return { title, text: "Você perdeu por inatividade.", mode: "lose" };
        return { title, text: "A partida terminou por inatividade.", mode: "neutral" };
    }
    if (reason === "opponent_left") {
        if (youWon)
            return { title, text: "Você ganhou porque o oponente saiu da sala.", mode: "win" };
        if (youLost)
            return { title, text: "Você perdeu porque saiu da sala.", mode: "lose" };
        return { title, text: "A partida terminou porque um jogador saiu da sala.", mode: "neutral" };
    }
    if (reason === "concede") {
        if (youWon)
            return { title, text: "Você venceu porque o oponente concedeu a partida.", mode: "win" };
        if (youLost)
            return { title, text: "Você concedeu a partida.", mode: "lose" };
        return { title, text: `${winner} venceu porque o adversário concedeu a partida.`, mode: "neutral" };
    }
    if (youWon)
        return { title, text: "Você venceu ao reduzir a vida do Escolhido inimigo a zero.", mode: "win" };
    if (youLost)
        return { title, text: "Você perdeu porque a vida do seu Escolhido chegou a zero.", mode: "lose" };
    return { title, text: `${winner} venceu a partida.`, mode: "neutral" };
}
function showVictory(viewState) {
    const modal = document.getElementById("victoryModal");
    const titleEl = document.getElementById("victoryTitle");
    const textEl = document.getElementById("victoryText");
    const imageWrapEl = document.getElementById("victoryMedia");
    const imageEl = document.getElementById("victoryImage");
    const creditEl = document.getElementById("victoryIllustrationCredit");
    if (!modal || !titleEl || !textEl || !imageWrapEl || !imageEl || !creditEl)
        return;
    const artwork = victoryBannerForLeader(viewState.mode);
    titleEl.textContent = viewState.title;
    textEl.textContent = viewState.text;
    if (artwork) {
        imageEl.onerror = null;
        imageEl.src = asAssetPath(artwork.src);
        imageEl.alt = `${viewState.title} - arte do Escolhido`;
        creditEl.textContent = artwork.credit;
        creditEl.hidden = false;
        imageWrapEl.style.display = "block";
    }
    else {
        imageEl.removeAttribute("src");
        imageEl.alt = "";
        creditEl.textContent = "";
        creditEl.hidden = true;
        imageWrapEl.style.display = "none";
    }
    modal.style.display = "flex";
}
function hideVictory() {
    const modal = document.getElementById("victoryModal");
    if (modal)
        modal.style.display = "none";
    const imageEl = document.getElementById("victoryImage");
    if (imageEl)
        imageEl.removeAttribute("src");
}
function ensureRevealModal() {
    let modal = document.getElementById("topRevealModal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "topRevealModal";
        modal.style.position = "fixed";
        modal.style.inset = "0";
        modal.style.display = "none";
        modal.style.alignItems = "center";
        modal.style.justifyContent = "center";
        modal.style.background = "rgba(0,0,0,0.58)";
        modal.style.zIndex = "1200";
        const box = document.createElement("div");
        box.style.width = "min(90vw, 440px)";
        box.style.maxHeight = "88dvh";
        box.style.background = "#141821";
        box.style.border = "1px solid rgba(255,255,255,.12)";
        box.style.borderRadius = "12px";
        box.style.padding = "16px";
        box.style.boxShadow = "0 16px 48px rgba(0,0,0,.45)";
        box.style.display = "grid";
        box.style.gap = "10px";
        box.style.overflowY = "auto";
        const title = document.createElement("div");
        title.id = "topRevealTitle";
        title.style.fontSize = "16px";
        title.style.fontWeight = "700";
        const text = document.createElement("div");
        text.id = "topRevealText";
        text.style.fontSize = "13px";
        text.style.lineHeight = "1.4";
        text.style.whiteSpace = "pre-wrap";
        text.style.opacity = "0.92";
        const img = document.createElement("img");
        img.id = "topRevealImg";
        img.style.width = "180px";
        img.style.margin = "0 auto";
        img.style.borderRadius = "10px";
        img.style.border = "1px solid rgba(255,255,255,.12)";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "primary";
        close.textContent = "Fechar";
        close.onclick = () => hideRevealModal();
        box.appendChild(title);
        box.appendChild(text);
        box.appendChild(img);
        box.appendChild(close);
        modal.appendChild(box);
        document.body.appendChild(modal);
    }
    const title = document.getElementById("topRevealTitle");
    const text = document.getElementById("topRevealText");
    const img = document.getElementById("topRevealImg");
    if (!modal || !title || !text || !img)
        return null;
    return { modal, title, text, img };
}
function hideRevealModal() {
    const modal = document.getElementById("topRevealModal");
    if (modal)
        modal.style.display = "none";
    if (revealHideTimer) {
        window.clearTimeout(revealHideTimer);
        revealHideTimer = null;
    }
}
function showRevealTopCardModal(payload) {
    const ui = ensureRevealModal();
    if (!ui)
        return;
    const cardId = String(payload?.cardId || "");
    if (!cardId)
        return;
    const card = resolveCard(cardId);
    const owner = ownerLabel(String(payload?.ownerSlot || ""));
    const source = String(payload?.sourceCardId || "Carta");
    const details = [
        String(card?.tipo || "").trim(),
        typeof card?.cost === "number" ? `Custo ${card.cost}` : "",
        card?.filiacao ? `Filiação ${card.filiacao}` : ""
    ].filter(Boolean).join(" • ");
    const description = String(card?.text || card?.description || "Sem descrição.").trim();
    ui.title.textContent = `Topo revelado de ${owner}`;
    ui.text.textContent = [source, card?.name || cardId, details, description].filter(Boolean).join("\n");
    setThumbnailSource(ui.img, card?.img || CARD_BACK_ASSET);
    ui.img.alt = card?.name || cardId;
    ui.modal.style.display = "flex";
    if (revealHideTimer)
        window.clearTimeout(revealHideTimer);
    revealHideTimer = window.setTimeout(() => hideRevealModal(), 15000);
}
function diaryCardPlayed(msg) {
    const owner = ownerLabel(String(msg?.slot || ""));
    const cardId = String(msg?.cardId || "");
    const lane = String(msg?.lane || "");
    const cardKind = getCardKind(cardId);
    if (lane === "field") {
        const pos = Number(msg?.targetPos);
        const posText = Number.isInteger(pos) && pos >= 0 ? ` no slot ${pos + 1}` : "";
        logText(`📘 ${owner} invocou aliado ${cardId}${posText}.`);
        return;
    }
    if (lane === "grave" && (cardKind === "spell" || cardKind === "truque")) {
        const tipo = cardKind === "spell" ? "magia" : "truque";
        logText(`✨ ${owner} ativou ${tipo} ${cardId}.`);
        return;
    }
    if (lane === "env") {
        logText(`🌍 ${owner} ativou ambiente ${cardId}.`);
    }
}
function diaryAttackResolved(msg) {
    const owner = ownerLabel(String(msg?.attackerSlot || ""));
    const attacker = String(msg?.attackerName || msg?.attackerId || "Atacante");
    const target = String(msg?.targetName || (msg?.target === "leader" ? "Líder" : "Aliado"));
    const damage = Number(msg?.damage || 0);
    const hit = !!msg?.hit;
    if (hit) {
        logText(`⚔️ ${owner}: ${attacker} atacou ${target} e causou ${damage} de dano.`);
        return;
    }
    logText(`⚔️ ${owner}: ${attacker} atacou ${target}, mas errou.`);
}
function diaryEffect(msg) {
    const owner = ownerLabel(String(msg?.slot || ""));
    const cardId = String(msg?.cardId || "carta");
    const rawText = String(msg?.text || "").trim();
    if (rawText) {
        const prefix = `${cardId}:`;
        const cleanText = rawText.startsWith(prefix) ? rawText.slice(prefix.length).trim() : rawText;
        logText(`🧩 ${owner}: ${cleanText}`);
        return;
    }
    logText(`🧩 ${owner} ativou ${cardId}.`);
}
function diaryTurnStart(msg) {
    const turnOwner = ownerLabel(String(msg?.turnSlot || ""));
    const add = Number(msg?.add || 0);
    const gainText = add > 0 ? ` e recebeu ${add} fragmento${add === 1 ? "" : "s"}` : "";
    logText(`🔄 Turno de ${turnOwner}${gainText}.`);
}
function normalizeCardId(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}
function basenameNoExt(value) {
    const normalized = String(value || "").replace(/\\/g, "/");
    const file = normalized.split("/").pop() || "";
    return file.replace(/\.[a-z0-9]+$/i, "");
}
function basenameCardKey(value) {
    return basenameNoExt(basenameNoExt(value));
}
function pathNoAssetsPrefix(value) {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/^assets\//i, "")
        .replace(/^public\//i, "");
}
function resolveCard(cardId) {
    const raw = String(cardId || "");
    const direct = cardLookup.get(normalizeCardId(raw));
    if (direct)
        return direct;
    const clean = pathNoAssetsPrefix(raw);
    const byClean = cardLookup.get(normalizeCardId(clean));
    if (byClean)
        return byClean;
    const byBase = cardLookup.get(normalizeCardId(basenameNoExt(clean)));
    if (byBase)
        return byBase;
    const byStem = cardLookup.get(normalizeCardId(basenameCardKey(clean)));
    if (byStem)
        return byStem;
    const expected = normalizeCardId(raw);
    const expectedClean = normalizeCardId(clean);
    const expectedBase = normalizeCardId(basenameNoExt(clean));
    const expectedStem = normalizeCardId(basenameCardKey(clean));
    for (const card of cardDefs) {
        const nameNorm = normalizeCardId(String(card?.name || ""));
        const keyNorm = normalizeCardId(String(card?.key || ""));
        const imgNorm = normalizeCardId(String(card?.img || ""));
        const imgCleanNorm = normalizeCardId(pathNoAssetsPrefix(String(card?.img || "")));
        const imgBaseNorm = normalizeCardId(basenameNoExt(String(card?.img || "")));
        const imgStemNorm = normalizeCardId(basenameCardKey(String(card?.img || "")));
        if (!expected)
            continue;
        if (expectedStem && [nameNorm, keyNorm, imgNorm, imgCleanNorm, imgBaseNorm, imgStemNorm].includes(expectedStem)) {
            return card;
        }
        const candidates = [nameNorm, keyNorm, imgNorm, imgCleanNorm, imgBaseNorm].filter(Boolean);
        if (candidates.some((value) => value.includes(expected) || expected.includes(value) || value.includes(expectedClean) || expectedClean.includes(value) || value.includes(expectedBase) || expectedBase.includes(value))) {
            return card;
        }
    }
    return undefined;
}
function normalizeKind(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function getCardKind(cardId) {
    const card = resolveCard(cardId);
    const raw = card?.kind || card?.tipo || "";
    const normalized = normalizeKind(raw);
    if (normalized === "ally" || normalized === "aliado")
        return "ally";
    if (normalized === "equip" || normalized === "equipamento")
        return "equip";
    if (normalized === "spell" || normalized === "magia")
        return "spell";
    if (normalized === "truque" || normalized === "trick")
        return "truque";
    if (normalized === "env" || normalized === "ambiente")
        return "env";
    return normalized || "spell";
}
function laneForCard(cardId) {
    const kind = getCardKind(cardId);
    if (kind === "env")
        return "env";
    return kind === "ally" ? "field" : "support";
}
function appendCostBadge(container, cost) {
    if (!Number.isFinite(cost))
        return;
    const badge = document.createElement("div");
    badge.className = "costTag";
    const value = document.createElement("span");
    value.textContent = String(cost);
    badge.appendChild(value);
    container.appendChild(badge);
}
function isNegativeChoiceOption(option) {
    const id = normalizeKind(String(option?.id || ""));
    const label = normalizeKind(String(option?.label || ""));
    return id.includes("-no")
        || id.includes("skip")
        || id.includes("cancel")
        || id.includes("fechar")
        || label.startsWith("nao ")
        || label === "nao ativar"
        || label === "cancelar"
        || label === "fechar";
}
function getChoiceSourceCardId(payload) {
    const explicit = String(payload?.sourceCardId || "").trim();
    if (explicit)
        return explicit;
    const options = Array.isArray(payload?.options) ? payload.options : [];
    for (const option of options) {
        const candidate = String(option?.cardId || option?.label || "").trim();
        if (candidate && resolveCard(candidate))
            return candidate;
    }
    const titleLead = String(payload?.title || "").split(":")[0]?.trim();
    if (titleLead && resolveCard(titleLead))
        return titleLead;
    return "";
}
function getChoiceOptionVisual(option, payload) {
    const explicit = String(option?.cardId || "").trim();
    if (explicit)
        return { cardId: explicit, muted: false };
    const labelCandidate = String(option?.label || "").trim();
    if (labelCandidate && resolveCard(labelCandidate)) {
        return { cardId: labelCandidate, muted: false };
    }
    const sourceCardId = getChoiceSourceCardId(payload);
    return { cardId: sourceCardId, muted: !!sourceCardId && isNegativeChoiceOption(option) };
}
function cardSubclassLine(card) {
    const parts = [String(card?.classe || "").trim(), String(card?.tipo || "").trim()].filter(Boolean);
    return parts.join(" • ");
}
function getSupportArrayForSide(side) {
    return side === "you" ? currentMySupport : currentEnemySupport;
}
function getSupportAttachArrayForSide(side) {
    return side === "you" ? currentMySupportAttach : currentEnemySupportAttach;
}
function getFieldAtkTempForSide(side, index) {
    const source = side === "you" ? currentMyFieldAtkTemp : currentEnemyFieldAtkTemp;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) ? value : 0;
}
function getFieldAtkPermForSide(side, index) {
    const source = side === "you" ? currentMyFieldAtkPerm : currentEnemyFieldAtkPerm;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) ? value : 0;
}
function getFieldAcPermForSide(side, index) {
    const source = side === "you" ? currentMyFieldAcPerm : currentEnemyFieldAcPerm;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) ? value : 0;
}
function getFieldBlessingForSide(side, index) {
    const source = side === "you" ? currentMyFieldBlessing : currentEnemyFieldBlessing;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
function getLeaderBlessingForSide(side) {
    return side === "you" ? currentMyLeaderBlessing : currentEnemyLeaderBlessing;
}
function getAttachedSupportNumericBonusForSide(side, targetPos, prop) {
    const supports = getSupportArrayForSide(side);
    const attach = getSupportAttachArrayForSide(side);
    const expectedTarget = targetPos == null ? -1 : targetPos;
    let total = 0;
    for (let index = 0; index < supports.length; index += 1) {
        const supportCardId = String(supports[index] || "").trim();
        if (!supportCardId)
            continue;
        if (Number(attach[index] ?? -2) !== expectedTarget)
            continue;
        const supportDef = resolveCard(supportCardId);
        const value = Number(supportDef?.[prop] || 0);
        if (Number.isFinite(value))
            total += value;
    }
    return total;
}
function getAttachedSupportCounterForSide(side, targetPos, effect) {
    const supports = getSupportArrayForSide(side);
    const attach = getSupportAttachArrayForSide(side);
    const counters = side === "you" ? currentMySupportCounters : currentEnemySupportCounters;
    const expectedTarget = targetPos == null ? -1 : targetPos;
    let total = 0;
    for (let index = 0; index < supports.length; index += 1) {
        const supportCardId = String(supports[index] || "").trim();
        if (!supportCardId || Number(attach[index] ?? -2) !== expectedTarget)
            continue;
        if (String(resolveCard(supportCardId)?.effect || "") !== effect)
            continue;
        const value = Number(counters[index] || 0);
        if (Number.isFinite(value) && value > 0)
            total += value;
    }
    return total;
}
function cardMatchesAuraTarget(cardId, auraTarget) {
    if (!auraTarget)
        return false;
    const def = resolveCard(cardId);
    if (!def)
        return false;
    if (auraTarget.classe)
        return normalizeKind(String(def?.classe || "")) === normalizeKind(String(auraTarget.classe || ""));
    if (auraTarget.tipo)
        return normalizeKind(String(def?.tipo || "")) === normalizeKind(String(auraTarget.tipo || ""));
    if (auraTarget.nameIncludes)
        return normalizeKind(String(def?.name || cardId || "")).includes(normalizeKind(String(auraTarget.nameIncludes || "")));
    return false;
}
function getAuraAttackBonusForSide(side, cardId) {
    let total = 0;
    const field = side === "you" ? currentMyField : currentEnemyField;
    for (const sourceCardId of field) {
        const sourceDef = resolveCard(sourceCardId);
        if (!sourceCardId || normalizeKind(String(sourceDef?.auraProp || "")) !== "atk")
            continue;
        if (!cardMatchesAuraTarget(cardId, sourceDef?.auraTarget))
            continue;
        const value = Number(sourceDef?.effectValue ?? 1);
        total += Number.isFinite(value) ? value : 1;
    }
    return total;
}
function getAuraHpBonusForSide(side, cardId) {
    let total = 0;
    const field = side === "you" ? currentMyField : currentEnemyField;
    for (const sourceCardId of field) {
        const sourceDef = resolveCard(sourceCardId);
        if (!sourceCardId || String(sourceDef?.effect || "") !== "aura_hp")
            continue;
        if (!cardMatchesAuraTarget(cardId, sourceDef?.auraTarget))
            continue;
        const value = Number(sourceDef?.effectValue ?? 1);
        total += Number.isFinite(value) ? value : 1;
    }
    return total;
}
function countOtherMarcialCardsInBattle(excludedSide, excludedIndex) {
    let total = 0;
    for (const cardId of [currentMyLeader, currentEnemyLeader])
        if (cardId && cardHasFiliation(cardId, "Marcial"))
            total += 1;
    for (const [side, source] of [["you", currentMyField], ["ai", currentEnemyField]]) {
        for (let index = 0; index < source.length; index += 1) {
            const cardId = source[index];
            if (side === excludedSide && index === excludedIndex)
                continue;
            if (cardId && cardHasFiliation(cardId, "Marcial"))
                total += 1;
        }
    }
    for (const source of [currentMySupport, currentEnemySupport]) {
        for (const cardId of source)
            if (cardId && cardHasFiliation(cardId, "Marcial"))
                total += 1;
    }
    for (const envId of [currentMyEnv, currentEnemyEnv])
        if (envId && cardHasFiliation(envId, "Marcial"))
            total += 1;
    return total;
}
function isYohanCard(cardId) {
    const card = resolveCard(cardId);
    const name = normalizeCardId(String(card?.name || cardId || ""));
    return name === normalizeCardId("Yohan, Ronin Vigilante")
        || name === normalizeCardId("Yoran, Ronin Vigilante")
        || cardEffectIds(cardId).includes("kornex_buff_per_marcial_in_play");
}
function getMarcialBattleBonus(cardId, side, index) {
    if (!isYohanCard(cardId))
        return 0;
    return Math.max(0, countOtherMarcialCardsInBattle(side, index));
}
function isMarcialBonusEnvCard(cardId) {
    const card = resolveCard(String(cardId || ""));
    if (String(card?.effect || "") === "marcial_bonus")
        return true;
    const normalized = normalizeCardId(String(card?.name || cardId || ""));
    return normalized === "camposensanguentados" || normalized === "campoensanguentado" || normalized === "camposbg";
}
function isMarcialCharacter(cardId) {
    const card = resolveCard(cardId);
    const source = normalizeKind(String(card?.filiacao || ""));
    return source.includes(normalizeKind("Marcial"));
}
function hasMarcialEnvAttackBonusForSide(side, attackerId) {
    if (!isMarcialBonusEnvCard(currentMyEnv) && !isMarcialBonusEnvCard(currentEnemyEnv))
        return false;
    const leaderId = side === "you" ? currentMyLeader : currentEnemyLeader;
    return cardHasFiliation(leaderId, "Marcial") && isMarcialCharacter(attackerId);
}
function getCurrentLeaderHp(side) {
    const value = side === "you" ? currentMyLeaderHp : currentEnemyLeaderHp;
    if (Number.isFinite(value) && value > 0)
        return value;
    const leaderId = side === "you" ? currentMyLeader : currentEnemyLeader;
    return Math.max(0, Number(resolveCard(leaderId)?.hp || 0));
}
function getLeaderAttackValue(side, cardId) {
    let total = Number(resolveCard(cardId)?.atkBonus || 0);
    total += getAttachedSupportNumericBonusForSide(side, null, "atkBonus");
    total += getAttachedSupportNumericBonusForSide(side, null, "dmgBonus");
    total += getAttachedSupportCounterForSide(side, null, "draw_bonus");
    if (hasMarcialEnvAttackBonusForSide(side, cardId))
        total += 1;
    return Math.max(0, total);
}
function buildChoiceAttackerSummary(payload) {
    const attackerId = String(payload?.attackerId || "").trim();
    const attackerName = String(payload?.attackerName || attackerId || "").trim();
    const currentAttack = Number(payload?.attackerAttack);
    if (!attackerName && !Number.isFinite(currentAttack))
        return "";
    const lines = [];
    if (attackerName)
        lines.push(`Atacante: ${attackerName}`);
    if (Number.isFinite(currentAttack))
        lines.push(`Ataque atual: ${currentAttack}`);
    const targetName = String(payload?.targetName || "").trim();
    if (targetName)
        lines.push(`Alvo atual: ${targetName}`);
    return lines.join("\n");
}
function getLeaderResistanceValue(side) {
    return Math.max(0, getAttachedSupportNumericBonusForSide(side, null, "acBonus"));
}
function getLeaderEquipResistanceBonus(side) {
    const equips = attachedEquipCards(side, null);
    let total = 0;
    for (const equipId of equips) {
        const equip = resolveCard(equipId);
        const value = Number(equip?.acBonus || 0);
        if (Number.isFinite(value))
            total += value;
    }
    return Math.max(0, total);
}
function getLeaderMaxHpValue(side, cardId) {
    const baseHp = Number(resolveCard(cardId)?.hp || 20);
    return Math.max(1, baseHp + getAttachedSupportNumericBonusForSide(side, null, "hpBonus") + getLeaderBlessingForSide(side));
}
function getFieldAttackValue(side, index, cardId) {
    let total = Number(resolveCard(cardId)?.atkBonus || 0);
    total += getFieldAtkTempForSide(side, index);
    total += getFieldAtkPermForSide(side, index);
    total += getAttachedSupportNumericBonusForSide(side, index, "atkBonus");
    total += getAttachedSupportNumericBonusForSide(side, index, "dmgBonus");
    total += getAttachedSupportCounterForSide(side, index, "draw_bonus");
    total += getFieldVitalMarksForSide(side, index);
    total += getAuraAttackBonusForSide(side, cardId);
    total += getMarcialBattleBonus(cardId, side, index);
    if (hasMarcialEnvAttackBonusForSide(side, cardId))
        total += 1;
    return Math.max(0, total);
}
function getFieldResistanceValue(side, index, cardId) {
    const baseAc = Number(resolveCard(cardId)?.ac ?? 0);
    return Math.max(0, baseAc + getFieldAcPermForSide(side, index) + getAttachedSupportNumericBonusForSide(side, index, "acBonus"));
}
function getBaseAllyInspectorStats(card) {
    const baseHp = Number(card?.hp || 1);
    const baseAttack = Number(card?.atkBonus || card?.damage || 0);
    const baseResistance = Number(card?.ac || 0);
    return [
        { label: "Vida", value: String(baseHp) },
        { label: "Ataque", value: String(baseAttack) },
        { label: "Resistência", value: String(baseResistance) }
    ];
}
function formatStatWithDelta(total, base) {
    const diff = total - base;
    if (diff === 0)
        return String(total);
    return `${total} (${diff > 0 ? "+" : ""}${diff})`;
}
function getFallbackFieldInspectorStats(view, card) {
    const hpValues = view.side === "you" ? currentMyFieldHp : currentEnemyFieldHp;
    const currentHp = Math.max(0, Number(hpValues[view.index || 0] ?? card?.hp ?? 1));
    const baseHp = Number(card?.hp || 1);
    const baseAttack = Number(card?.atkBonus || 0);
    const baseResistance = Number(card?.ac || 0);
    const marcialBonus = getMarcialBattleBonus(view.cardId, view.side, view.index || 0);
    const attackValue = baseAttack + marcialBonus;
    const out = [
        { label: "Vida", value: `${currentHp}/${baseHp}` },
        { label: "Ataque", value: formatStatWithDelta(attackValue, baseAttack), tone: attackValue > baseAttack ? "good" : "neutral" },
        { label: "Resistência", value: String(baseResistance) }
    ];
    if (marcialBonus > 0)
        out.push({ label: "Bônus Marcial", value: `+${marcialBonus}`, tone: "gold" });
    return out;
}
function getYohanInspectorStats(view, card) {
    const index = typeof view.index === "number" ? view.index : 0;
    const hpValues = view.side === "you" ? currentMyFieldHp : currentEnemyFieldHp;
    const currentHp = Math.max(0, Number(hpValues[index] ?? card.hp ?? 1));
    const baseHp = Number(card.hp || 1);
    const baseAttack = Number(card.atkBonus || 0);
    const baseResistance = Number(card.ac || 0);
    const attack = getFieldAttackValue(view.side, index, view.cardId);
    const resistance = getFieldResistanceValue(view.side, index, view.cardId);
    const marcialBonus = getMarcialBattleBonus(view.cardId, view.side, index);
    const out = [
        { label: "Vida", value: `${currentHp}/${baseHp}` },
        { label: "Ataque", value: formatStatWithDelta(attack, baseAttack), tone: attack > baseAttack ? "good" : "neutral" },
        { label: "Resistência", value: formatStatWithDelta(resistance, baseResistance), tone: resistance > baseResistance ? "good" : "neutral" }
    ];
    if (marcialBonus > 0)
        out.push({ label: "Bônus Marcial", value: `+${marcialBonus}`, tone: "gold" });
    return out;
}
function getInspectorStats(view) {
    if (!view?.cardId)
        return [];
    const card = resolveCard(view.cardId);
    if (!card)
        return [];
    if (view.lane === "leader" && view.side) {
        const baseHp = Number(card.hp || 20);
        const currentHp = Math.max(0, getCurrentLeaderHp(view.side));
        const maxHp = getLeaderMaxHpValue(view.side, view.cardId);
        const resistance = getLeaderResistanceValue(view.side);
        return [
            { label: "Vida", value: `${currentHp}/${maxHp}`, tone: currentHp < maxHp ? (currentHp / Math.max(1, maxHp) <= 0.5 ? "bad" : "neutral") : (maxHp > baseHp ? "gold" : "neutral") },
            { label: "Resistência", value: String(resistance), tone: resistance > 0 ? "good" : "neutral" }
        ];
    }
    if (view.lane === "field" && view.side && typeof view.index === "number") {
        if (card && isYohanCard(view.cardId))
            return getYohanInspectorStats(view, card);
        const hpValues = view.side === "you" ? currentMyFieldHp : currentEnemyFieldHp;
        const currentHp = Math.max(0, Number(hpValues[view.index] ?? 0));
        const maxHp = getDisplayedFieldMaxHp(view.side, view.index, view.cardId);
        const attack = getFieldAttackValue(view.side, view.index, view.cardId);
        const resistance = getFieldResistanceValue(view.side, view.index, view.cardId);
        const baseAttack = Number(card.atkBonus || 0);
        const baseResistance = Number(card.ac || 0);
        const baseHp = Number(card.hp || 1);
        const marcialBonus = getMarcialBattleBonus(view.cardId, view.side, view.index);
        const hpValue = maxHp === baseHp ? `${currentHp}/${maxHp}` : `${currentHp}/${maxHp} (${maxHp > baseHp ? "+" : ""}${maxHp - baseHp})`;
        const out = [
            { label: "Vida", value: hpValue, tone: currentHp < maxHp ? (currentHp / Math.max(1, maxHp) <= 0.5 ? "bad" : "neutral") : (maxHp > baseHp ? "good" : "neutral") },
            { label: "Ataque", value: String(attack), tone: attack > baseAttack ? "good" : (attack < baseAttack ? "bad" : "neutral") },
            { label: "Resistência", value: formatStatWithDelta(resistance, baseResistance), tone: resistance > baseResistance ? "good" : (resistance < baseResistance ? "bad" : "neutral") }
        ];
        if (marcialBonus > 0)
            out.push({ label: "Bônus Marcial", value: `+${marcialBonus}`, tone: "gold" });
        return out;
    }
    if (view.lane === "support") {
        return [
            Number(card?.hpBonus || 0) ? { label: "Vida", value: `+${Number(card?.hpBonus || 0)}`, tone: "good" } : null,
            Number(card?.atkBonus || 0) ? { label: "Ataque", value: `+${Number(card?.atkBonus || 0)}`, tone: "good" } : null,
            Number(card?.acBonus || 0) ? { label: "Resistência", value: `+${Number(card?.acBonus || 0)}`, tone: "good" } : null,
            Number(card?.dmgBonus || 0) ? { label: "Dano", value: `+${Number(card?.dmgBonus || 0)}`, tone: "gold" } : null
        ].filter(Boolean);
    }
    if (getCardKind(view.cardId) === "ally") {
        return getBaseAllyInspectorStats(card);
    }
    if (getCardKind(view.cardId) === "chosen") {
        const baseHp = Number(card.hp || 20);
        return [{ label: "Vida", value: String(baseHp), tone: "gold" }];
    }
    return [];
}
function getInspectorStatsSafe(view) {
    try {
        return getInspectorStats(view);
    }
    catch {
        const card = resolveCard(view?.cardId || "");
        if (view?.lane === "field" && view.side && typeof view.index === "number")
            return getFallbackFieldInspectorStats(view, card);
        if (getCardKind(view?.cardId || "") === "ally")
            return getBaseAllyInspectorStats(card);
        return [];
    }
}
function canSelectCombatTarget(target) {
    if (!isMyTurn || currentPhase !== "COMBAT" || selectedAttackerPos === null)
        return false;
    const runtime = getBattleRuntime();
    return canAttackTargetQuiet(runtime, { side: "you", idx: selectedAttackerPos }, target);
}
function cardPreviewDetails(cardId, card, includeCost = true, includeFiliation = true, view = null) {
    const headline = [
        card?.name || cardId,
        includeCost && typeof card?.cost === "number" ? `Custo ${card.cost}` : "",
        includeFiliation && card?.filiacao ? `Filiação ${card.filiacao}` : ""
    ].filter(Boolean).join(" • ");
    const subclass = cardSubclassLine(card);
    const text = String(card?.text || "").trim();
    return [headline, subclass, text].filter(Boolean).join("\n");
}
function previewFiliationLine(card) {
    const parts = [String(card?.filiacao || "").trim(), typeof card?.cost === "number" ? `Custo ${card.cost}` : ""].filter(Boolean);
    return parts.join(" • ");
}
function previewTextLine(cardId, card) {
    const text = String(card?.text || "").trim();
    return text || String(card?.description || "").trim() || String(card?.tipo || cardId || "").trim();
}
function buildMobileInspectCard(target) {
    const nextView = normalizedInspectorView(typeof target === "string" ? { cardId: target } : target);
    if (!nextView?.cardId)
        return null;
    const card = resolveCard(nextView.cardId);
    return {
        cardId: nextView.cardId,
        title: String(card?.name || nextView.cardId || "Carta"),
        imageSrc: asThumbnailAssetPath(card?.img || CARD_BACK_ASSET),
        typeLine: cardSubclassLine(card),
        filiationLine: previewFiliationLine(card),
        text: previewTextLine(nextView.cardId, card),
        formatEffects: card?.escolha1 === true || card?.kind === "leader",
        isChoiceOne: card?.escolha1 === true,
        keywords: Array.isArray(card?.keywords) ? card.keywords : [],
        stats: getInspectorStatsSafe(nextView).map((item) => `${item.label}: ${item.value}`),
    };
}
function bindMobileCardInspect(element, target) {
    const inspectElement = element;
    inspectElement.__mobileInspectTarget = target;
    if (inspectElement.__mobileInspectBound)
        return;
    inspectElement.__mobileInspectBound = true;
    mobileCardInspect.bind(inspectElement, () => buildMobileInspectCard(inspectElement.__mobileInspectTarget || null));
}
function asAssetPath(path) {
    if (!path)
        return "";
    if (/^(https?:|data:|file:|\/\/)/i.test(path))
        return path;
    const appendVersion = (value) => {
        const separator = value.includes("?") ? "&" : "?";
        return `${value}${separator}v=${encodeURIComponent(ASSET_CACHE_VERSION)}`;
    };
    if (path.startsWith("/"))
        return appendVersion(path);
    let normalized = String(path).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\.\.\//, "");
    if (normalized.startsWith("assets/"))
        normalized = normalized.slice("assets/".length);
    return appendVersion(`/${normalized}`);
}
function asThumbnailAssetPath(path) {
    if (/^(https?:|data:|file:|\/\/)/i.test(path) || path.includes(".thumb."))
        return asAssetPath(path);
    const cleanPath = String(path).split(/[?#]/, 1)[0];
    const normalized = cleanPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/^\.\.\//, "")
        .replace(/^\//, "")
        .replace(/^assets\//, "");
    const thumbnailPath = normalized.replace(/\.(png|jpe?g|webp|avif)$/i, ".thumb.webp");
    if (thumbnailPath === normalized)
        return asAssetPath(path);
    return asAssetPath(`/publicadas/${thumbnailPath}`);
}
function setThumbnailSource(image, path) {
    const originalSource = asAssetPath(path);
    const thumbnailSource = asThumbnailAssetPath(path);
    image.onerror = thumbnailSource === originalSource
        ? null
        : () => {
            image.onerror = null;
            image.src = originalSource;
        };
    image.src = thumbnailSource;
}
function cardKeywords(cardId) {
    const card = resolveCard(cardId);
    const text = String(card?.text || "").toLowerCase();
    const keywords = [];
    const rawKeywords = Array.isArray(card?.keywords) ? card.keywords.map((kw) => String(kw || "").toLowerCase()) : [];
    if (rawKeywords.includes("investida") || text.includes("investida"))
        keywords.push("investida");
    if (rawKeywords.includes("provocar") || text.includes("provocar") || text.includes("desafio"))
        keywords.push("provocar");
    if (rawKeywords.includes("bloquear") || text.includes("bloquear") || text.includes("interpor"))
        keywords.push("bloquear");
    if (text.includes("precis") || text.includes("precisão"))
        keywords.push("precisao");
    if (rawKeywords.includes("atropelar") || text.includes("atropelar"))
        keywords.push("atropelar");
    return keywords;
}
function cardEffectIds(cardId) {
    const card = resolveCard(cardId);
    const raw = [card?.effect, card?.effectA, card?.effectB];
    const seen = new Set();
    const out = [];
    for (const value of raw) {
        if (typeof value !== "string")
            continue;
        const effectId = String(value || "").trim();
        if (!effectId || seen.has(effectId))
            continue;
        seen.add(effectId);
        out.push(effectId);
    }
    return out;
}
function leaderHasEffect(cardId, effectId) {
    return cardEffectIds(cardId).includes(String(effectId || "").trim());
}
function hasManualLeaderPower(cardId) {
    return leaderHasEffect(cardId, "valbrak_citizen_boost")
        || leaderHasEffect(cardId, "ademais_spider_burst")
        || leaderHasEffect(cardId, "leafae_vital_guard");
}
function canUseLeaderPower() {
    if (!room || !isMyTurn || currentPhase !== "PREP" || currentMyLeaderTapped)
        return false;
    if (leaderHasEffect(currentMyLeader, "valbrak_citizen_boost"))
        return currentMyFragments >= 2;
    if (leaderHasEffect(currentMyLeader, "ademais_spider_burst"))
        return currentMyLeaderSpiderMarks >= 4;
    if (leaderHasEffect(currentMyLeader, "leafae_vital_guard"))
        return currentMyLeaderVitalMarks >= 3;
    return false;
}
function toBattleCard(cardId, side, index) {
    const cleanId = String(cardId || "").trim();
    if (!cleanId)
        return null;
    const card = resolveCard(cleanId);
    return {
        name: card?.name || cleanId,
        hp: 1,
        ac: 1,
        tapped: tappedBySide[side].has(index),
        summonedThisTurn: summonedBySide[side].has(index),
        classe: card?.classe,
        keywords: cardKeywords(cleanId),
        atkBonus: 0,
        atkBonusTemp: 0,
        damage: 1,
        damageBonusTemp: 0
    };
}
function getBattleRuntime() {
    const youLeaderDef = resolveCard(currentMyLeader);
    const aiLeaderDef = resolveCard(currentEnemyLeader);
    return {
        state: {
            phase: currentBattlePhase(),
            turnCount: { you: myTurnCount, ai: enemyTurnCount },
            you: {
                leader: currentMyLeader ? { name: youLeaderDef?.name || currentMyLeader, hp: Number(youLeaderDef?.hp || 20), tapped: currentMyLeaderTapped } : null,
                allies: currentMyField.map((cardId, index) => toBattleCard(cardId, "you", index)),
                grave: []
            },
            ai: {
                leader: currentEnemyLeader ? { name: aiLeaderDef?.name || currentEnemyLeader, hp: Number(aiLeaderDef?.hp || 20), tapped: currentEnemyLeaderTapped } : null,
                allies: currentEnemyField.map((cardId, index) => toBattleCard(cardId, "ai", index)),
                grave: []
            }
        },
        rnd: (sides) => Math.floor(Math.random() * Math.max(1, sides)),
        hasKw: (card, keyword) => {
            const expected = normalizeKind(keyword);
            return (card.keywords || []).some((kw) => normalizeKind(kw) === expected);
        },
        leaderIs: (side, idOrName) => {
            const leaderId = side === "you" ? currentMyLeader : currentEnemyLeader;
            const leaderDef = resolveCard(leaderId);
            const probe = normalizeCardId(idOrName);
            return normalizeCardId(leaderId) === probe
                || normalizeCardId(leaderDef?.name || "") === probe
                || normalizeCardId(leaderDef?.key || "") === probe
                || cardEffectIds(leaderId).some((effectId) => normalizeCardId(effectId) === probe);
        },
        getAC: () => 1,
        log,
        logEffect: (message) => log("EFFECT", { text: message }),
        logAttackResult: (hit, message) => log(hit ? "HIT" : "MISS", { text: message }),
        render: () => {
            if (view.selectedAttackerEl) {
                if (selectedAttackerPos === null)
                    view.selectedAttackerEl.textContent = "—";
                else
                    view.selectedAttackerEl.textContent = `[${selectedAttackerPos}] ${currentMyField[selectedAttackerPos] || "—"}`;
            }
        },
        onAttackResolved: (selection, target) => {
            if (!room)
                return;
            if (selection.side !== "you")
                return;
            if (selection.leader)
                return;
            stopAttackArrow();
            resetBoardAttackSelection();
            if (target.type === "ally") {
                selectedTargetType = "ally";
                selectedTargetPos = target.index;
                room.send("attack", { attackerPos: selection.idx, target: "ally", targetPos: target.index });
                return;
            }
            selectedTargetType = "leader";
            selectedTargetPos = null;
            room.send("attack", { attackerPos: selection.idx, target: "leader" });
        },
        serverAuthoritative: true
    };
}
function getAttackConfirmEls() {
    return {
        modal: document.getElementById("attackConfirmModal"),
        title: document.getElementById("attackConfirmTitle"),
        text: document.getElementById("attackConfirmText"),
        btnYes: document.getElementById("btnAttackConfirmYes"),
        btnNo: document.getElementById("btnAttackConfirmNo")
    };
}
function hideAttackConfirmModal() {
    pendingAttackConfirmPos = null;
    const { modal } = getAttackConfirmEls();
    if (modal)
        modal.style.display = "none";
}
function showAttackConfirmModal(index) {
    pendingAttackConfirmPos = index;
    const cardId = currentMyField[index] || "esta carta";
    const card = resolveCard(cardId);
    const { modal, title, text } = getAttackConfirmEls();
    if (title)
        title.textContent = `Atacar com ${card?.name || cardId}?`;
    if (text)
        text.textContent = "Confirme para escolher o alvo do ataque. Se cancelar, a fase de combate continua sem alterar a seleção.";
    if (modal)
        modal.style.display = "flex";
}
function confirmPendingBoardAttack() {
    const index = pendingAttackConfirmPos;
    hideAttackConfirmModal();
    if (index === null)
        return;
    commitBoardAttackFrom(index);
}
function beginBoardAttackFrom(index) {
    if (!isMyTurn || currentPhase !== "COMBAT")
        return;
    if (selectedAttackerPos === index) {
        resetBoardAttackSelection();
        cancelBoardAttackSelection();
        return;
    }
    const runtime = getBattleRuntime();
    const card = runtime.state.you.allies[index] ?? null;
    if (!canAttackCardQuiet(runtime, "you", card)) {
        resetBoardAttackSelection();
        cancelBoardAttackSelection();
        return;
    }
    showAttackConfirmModal(index);
}
function commitBoardAttackFrom(index) {
    if (!isMyTurn || currentPhase !== "COMBAT")
        return;
    const runtime = getBattleRuntime();
    const card = runtime.state.you.allies[index] ?? null;
    if (!canAttackCardQuiet(runtime, "you", card)) {
        resetBoardAttackSelection();
        cancelBoardAttackSelection();
        return;
    }
    selectedAttackerPos = index;
    selectedTargetType = "leader";
    selectedTargetPos = null;
    startAttackArrow(document.getElementById(`you-ally-${index}`));
    if (view.selectedAttackerEl)
        view.selectedAttackerEl.textContent = `[${index}] ${currentMyField[index] || "—"}`;
    if (view.selectedTargetEl)
        view.selectedTargetEl.textContent = "Líder inimigo";
    rerenderCombatSelectionState();
    selectAttacker(runtime, "you", index);
    if (!document.querySelector(".slot.clickable")) {
        resetBoardAttackSelection();
        cancelBoardAttackSelection();
    }
}
function canSelectCombatAttacker(index) {
    if (!isMyTurn || currentPhase !== "COMBAT")
        return false;
    if (selectedAttackerPos === index)
        return true;
    const runtime = getBattleRuntime();
    const card = runtime.state.you.allies[index] ?? null;
    return canAttackCardQuiet(runtime, "you", card);
}
function rerenderCombatSelectionState() {
    renderMyField(currentMyField, currentMyFieldHp);
    renderEnemyField(currentEnemyField, currentEnemyFieldHp);
    renderLeaderSlot("you-leader", currentMyLeader, currentMyLeaderHp);
    renderLeaderSlot("ai-leader", currentEnemyLeader, currentEnemyLeaderHp);
    syncEnemyLeaderCombatTargetState();
}
function syncEnemyLeaderCombatTargetState() {
    const enemyLeaderSlot = document.getElementById("ai-leader");
    if (!enemyLeaderSlot)
        return;
    enemyLeaderSlot.classList.toggle("combat-target", canSelectCombatTarget({ type: "leader", side: "ai" }));
    clearAttackTargetHover(enemyLeaderSlot);
    enemyLeaderSlot.onclick = () => {
        if (!canSelectCombatTarget({ type: "leader", side: "ai" }))
            return;
        resolveSelectedBoardAttack({ type: "leader", side: "ai" });
    };
    if (canSelectCombatTarget({ type: "leader", side: "ai" })) {
        enemyLeaderSlot.__attackHoverCleanup = bindAttackTargetHover(enemyLeaderSlot);
    }
}
function cancelBoardAttackSelection() {
    stopAttackArrow();
    endAttackCleanup(getBattleRuntime());
}
function resetBoardAttackSelection() {
    stopAttackArrow();
    selectedAttackerPos = null;
    selectedTargetType = "leader";
    selectedTargetPos = null;
    if (view.selectedAttackerEl)
        view.selectedAttackerEl.textContent = "—";
    if (view.selectedTargetEl)
        view.selectedTargetEl.textContent = "Líder inimigo";
    rerenderCombatSelectionState();
}
function resolveSelectedBoardAttack(target) {
    const runtime = getBattleRuntime();
    if (selectedAttackerPos !== null) {
        selectAttacker(runtime, "you", selectedAttackerPos);
    }
    resolveAttackOn(runtime, target);
    stopAttackArrow();
    resetBoardAttackSelection();
}
function sameInspectorView(a, b) {
    return a?.cardId === b?.cardId && a?.side === b?.side && a?.lane === b?.lane && a?.index === b?.index;
}
function normalizedInspectorView(viewState) {
    if (!viewState?.cardId || !String(viewState.cardId).trim())
        return null;
    return {
        cardId: String(viewState.cardId).trim(),
        side: viewState.side,
        lane: viewState.lane,
        index: typeof viewState.index === "number" ? viewState.index : undefined
    };
}
function renderInspector(target) {
    const img = document.getElementById("bigImg");
    const meta = document.getElementById("bigMeta");
    const stats = document.getElementById("bigStats");
    const titleEl = document.getElementById("bigMetaTitle");
    const filiationEl = document.getElementById("bigMetaFiliation");
    const subclassEl = document.getElementById("bigMetaSubclass");
    const textEl = document.getElementById("bigMetaText");
    if (!img || !meta || !stats || !titleEl || !filiationEl || !subclassEl || !textEl)
        return;
    const nextView = normalizedInspectorView(typeof target === "string" ? { cardId: target } : target);
    if (!nextView?.cardId) {
        img.src = "";
        img.alt = "Carta selecionada";
        stats.innerHTML = "";
        titleEl.textContent = "Passe o mouse em uma carta";
        filiationEl.textContent = "para ver detalhes.";
        subclassEl.textContent = "";
        textEl.textContent = "";
        return;
    }
    const card = resolveCard(nextView.cardId);
    if (card?.img)
        setThumbnailSource(img, card.img);
    else
        img.src = "";
    img.alt = card?.name || nextView.cardId;
    stats.innerHTML = "";
    for (const item of getInspectorStatsSafe(nextView)) {
        const pill = document.createElement("div");
        pill.className = `bigStat${item.tone ? ` bigStat--${item.tone}` : ""}`;
        pill.textContent = `${item.label}: ${item.value}`;
        stats.appendChild(pill);
    }
    titleEl.textContent = String(card?.name || nextView.cardId || "Carta");
    filiationEl.textContent = previewFiliationLine(card);
    subclassEl.textContent = cardSubclassLine(card);
    renderCardRulesText(textEl, previewTextLine(nextView.cardId, card), card?.escolha1 === true || card?.kind === "leader", card?.escolha1 === true, Array.isArray(card?.keywords) ? card.keywords : []);
}
function setInspector(target) {
    const nextView = normalizedInspectorView(typeof target === "string" ? { cardId: target } : target);
    selectedInspectorView = nextView;
    selectedHandCardId = nextView?.lane === "hand" ? nextView.cardId : (nextView?.cardId || selectedHandCardId);
    renderInspector(nextView);
}
function setHoveredInspector(target) {
    hoveredInspectorView = normalizedInspectorView(typeof target === "string" ? { cardId: target } : target);
    const fallback = hoveredInspectorView || selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId } : null);
    renderInspector(fallback);
}
function isMobileGameplay() {
    return window.matchMedia("(max-width: 980px)").matches;
}
function syncMobilePreviewState() {
    const button = document.getElementById("btnTogglePreview");
    const fab = document.getElementById("mobilePreviewFab");
    const isOpen = document.body.classList.contains("mobile-preview-open");
    const isMobile = isMobileGameplay();
    if (isMobile)
        document.body.classList.remove("mobile-preview-open");
    if (button) {
        button.textContent = isMobile ? "Fechar" : "Minimizar";
        button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
    if (fab) {
        fab.hidden = true;
        fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
        fab.classList.toggle("is-active", isOpen);
        fab.setAttribute("aria-label", isOpen ? "Fechar detalhes da carta" : "Ver detalhes da carta");
    }
}
function openMobilePreview(target) {
    const nextTarget = target || (isMobileGameplay()
        ? (selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId, side: "you", lane: "hand" } : null) || hoveredInspectorView)
        : (hoveredInspectorView || selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId } : null)));
    if (nextTarget)
        setInspector(nextTarget);
    if (!isMobileGameplay())
        return;
    return;
}
function closeMobilePreview() {
    document.body.classList.remove("mobile-preview-open");
    syncMobilePreviewState();
}
function toggleMobilePreview() {
    if (!isMobileGameplay())
        return;
    if (document.body.classList.contains("mobile-preview-open")) {
        closeMobilePreview();
        return;
    }
    openMobilePreview();
}
function attachMobilePreviewGesture(element, inspectorTarget) {
    bindMobileCardInspect(element, inspectorTarget || null);
}
function setupMobilePreviewToggle() {
    const button = document.getElementById("btnTogglePreview");
    const fab = document.getElementById("mobilePreviewFab");
    if (fab)
        fab.hidden = true;
    if (!button)
        return;
    let suppressFabClick = false;
    const saveFabPosition = (left, top) => {
        try {
            localStorage.setItem(MOBILE_PREVIEW_FAB_POSITION_KEY, JSON.stringify({ left, top }));
        }
        catch {
            // Ignore storage failures.
        }
    };
    const clampFabPosition = (left, top) => {
        if (!fab)
            return { left, top };
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - fab.offsetWidth - margin);
        const maxTop = Math.max(margin, window.innerHeight - fab.offsetHeight - margin);
        return {
            left: Math.min(Math.max(margin, left), maxLeft),
            top: Math.min(Math.max(margin, top), maxTop),
        };
    };
    const applyFabPosition = (left, top, persist = false) => {
        if (!fab)
            return;
        const next = clampFabPosition(left, top);
        fab.style.left = `${Math.round(next.left)}px`;
        fab.style.top = `${Math.round(next.top)}px`;
        fab.style.bottom = "auto";
        if (persist)
            saveFabPosition(next.left, next.top);
    };
    const restoreFabPosition = () => {
        if (!fab)
            return;
        try {
            const raw = localStorage.getItem(MOBILE_PREVIEW_FAB_POSITION_KEY);
            if (!raw)
                return;
            const parsed = JSON.parse(raw);
            const left = Number(parsed?.left);
            const top = Number(parsed?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top))
                return;
            applyFabPosition(left, top);
        }
        catch {
            // Ignore invalid persisted position.
        }
    };
    button.onclick = () => {
        if (!isMobileGameplay())
            return;
        closeMobilePreview();
    };
    if (fab) {
        fab.onclick = () => {
            if (suppressFabClick) {
                suppressFabClick = false;
                return;
            }
            toggleMobilePreview();
        };
        let pointerId = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let originLeft = 0;
        let originTop = 0;
        let moved = false;
        fab.addEventListener("pointerdown", (event) => {
            if (!isMobileGameplay())
                return;
            pointerId = event.pointerId;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            const rect = fab.getBoundingClientRect();
            originLeft = rect.left;
            originTop = rect.top;
            moved = false;
            fab.classList.add("is-dragging");
            fab.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        fab.addEventListener("pointermove", (event) => {
            if (pointerId !== event.pointerId)
                return;
            const deltaX = event.clientX - dragStartX;
            const deltaY = event.clientY - dragStartY;
            if (!moved && Math.hypot(deltaX, deltaY) < 6)
                return;
            moved = true;
            applyFabPosition(originLeft + deltaX, originTop + deltaY);
            event.preventDefault();
        });
        const finishDrag = (event) => {
            if (pointerId !== event.pointerId)
                return;
            fab.classList.remove("is-dragging");
            fab.releasePointerCapture?.(event.pointerId);
            pointerId = null;
            if (!moved)
                return;
            suppressFabClick = true;
            const rect = fab.getBoundingClientRect();
            applyFabPosition(rect.left, rect.top, true);
            window.setTimeout(() => {
                suppressFabClick = false;
            }, 180);
        };
        fab.addEventListener("pointerup", finishDrag);
        fab.addEventListener("pointercancel", finishDrag);
        restoreFabPosition();
    }
    window.addEventListener("resize", () => {
        if (!isMobileGameplay())
            document.body.classList.remove("mobile-preview-open");
        if (fab && fab.style.left && fab.style.top) {
            const rect = fab.getBoundingClientRect();
            applyFabPosition(rect.left, rect.top, true);
        }
        syncMobilePreviewState();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape")
            closeMobilePreview();
    });
    syncMobilePreviewState();
}
function buildHandCard(cardId, selected, onClick, inspectorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card handCard slotCard";
    button.style.cursor = onClick ? "pointer" : "default";
    button.style.padding = "0";
    button.draggable = !!onClick;
    button.dataset.cardId = cardId;
    button.dataset.cardKind = getCardKind(cardId);
    if (selected)
        button.classList.add("is-selected");
    const card = resolveCard(cardId);
    if (card?.img) {
        const image = document.createElement("img");
        setThumbnailSource(image, card.img);
        image.alt = card.name || cardId;
        image.className = "slotCardImg";
        image.decoding = "async";
        image.loading = "lazy";
        button.appendChild(image);
    }
    else {
        const fallback = document.createElement("div");
        fallback.className = "slotCardFallback";
        fallback.textContent = cardId;
        button.appendChild(fallback);
    }
    if (inspectorView?.lane === "hand")
        appendCostBadge(button, card?.cost);
    attachMobilePreviewGesture(button, inspectorView || cardId);
    button.onmouseenter = () => setHoveredInspector(inspectorView || cardId);
    button.onfocus = () => setHoveredInspector(inspectorView || cardId);
    button.onmouseleave = () => setHoveredInspector(null);
    button.onblur = () => setHoveredInspector(null);
    button.ondragstart = (event) => {
        if (!event.dataTransfer || !isMyTurn || currentPhase !== "PREP")
            return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", cardId);
        event.dataTransfer.setData("application/x-card-kind", getCardKind(cardId));
    };
    if (onClick)
        button.onclick = onClick;
    return button;
}
function hideMulliganModal() {
    const modal = document.getElementById("mulliganModal");
    if (modal)
        modal.style.display = "none";
}
function syncInitiativeUi(state) {
    const modal = document.getElementById("initiativeModal");
    const intro = document.getElementById("initiativeIntro");
    const rollButton = document.getElementById("initiativeRollButton");
    const choiceActions = document.getElementById("initiativeChoiceActions");
    const youDie = document.getElementById("initiativeYouDie");
    const opponentDie = document.getElementById("initiativeOpponentDie");
    const youValue = document.getElementById("initiativeYouValue");
    const opponentValue = document.getElementById("initiativeOpponentValue");
    const opponentName = document.getElementById("initiativeOpponentName");
    const youDieValue = youDie?.querySelector(".initiativeDieValue");
    const opponentDieValue = opponentDie?.querySelector(".initiativeDieValue");
    if (!modal || !intro || !rollButton || !choiceActions || !youDie || !opponentDie || !youValue || !opponentValue || !opponentName || !youDieValue || !opponentDieValue)
        return;
    const active = !isSpectator && !!slot && String(state?.phase || "") === "INITIATIVE";
    if (!active) {
        modal.style.display = "none";
        return;
    }
    const status = String(state?.initiativeStatus || "WAITING");
    const p1Roll = Number(state?.p1InitiativeRoll || 0);
    const p2Roll = Number(state?.p2InitiativeRoll || 0);
    const myRoll = slot === "p1" ? p1Roll : p2Roll;
    const opponentRoll = slot === "p1" ? p2Roll : p1Roll;
    const opponentSlot = slot === "p1" ? "p2" : "p1";
    opponentName.textContent = getPublicPlayerName(state, opponentSlot);
    const winnerSlot = String(state?.initiativeWinnerSlot || "");
    const iWon = winnerSlot === slot;
    const resultVisible = !!winnerSlot && !!myRoll && !!opponentRoll;
    const rolling = status === "ROLLING" && (!myRoll || !opponentRoll);
    youDie.classList.toggle("is-rolling", rolling && !myRoll);
    opponentDie.classList.toggle("is-rolling", rolling && !opponentRoll);
    youDie.classList.toggle("is-winner", resultVisible && iWon);
    youDie.classList.toggle("is-loser", resultVisible && !iWon);
    opponentDie.classList.toggle("is-winner", resultVisible && !iWon);
    opponentDie.classList.toggle("is-loser", resultVisible && iWon);
    youValue.classList.toggle("is-winner", resultVisible && iWon);
    youValue.classList.toggle("is-loser", resultVisible && !iWon);
    opponentValue.classList.toggle("is-winner", resultVisible && !iWon);
    opponentValue.classList.toggle("is-loser", resultVisible && iWon);
    youDieValue.textContent = myRoll ? String(myRoll) : "D20";
    opponentDieValue.textContent = opponentRoll ? String(opponentRoll) : "D20";
    youDie.setAttribute("aria-label", myRoll ? `Seu dado: ${myRoll}` : "Seu dado: aguardando resultado");
    opponentDie.setAttribute("aria-label", opponentRoll ? `Dado de ${opponentName.textContent}: ${opponentRoll}` : `Dado de ${opponentName.textContent}: aguardando resultado`);
    youValue.textContent = myRoll ? String(myRoll) : "—";
    opponentValue.textContent = opponentRoll ? String(opponentRoll) : "—";
    choiceActions.style.display = status === "CHOOSING" && iWon ? "flex" : "none";
    rollButton.style.display = status === "ROLLING" ? "" : "none";
    rollButton.disabled = !!myRoll;
    if (status === "WAITING")
        intro.textContent = "Aguardando os dois jogadores para iniciar a disputa.";
    else if (status === "ROLLING")
        intro.textContent = myRoll ? "Você rolou. Aguardando a rolagem do oponente." : "Role um D20. O maior resultado escolhe quem começa.";
    else if (status === "TIE")
        intro.textContent = "Empate na iniciativa. Rolando novamente...";
    else if (status === "CHOOSING")
        intro.textContent = iWon ? "Você venceu a iniciativa. Escolha a ordem de jogo." : "Seu oponente venceu a iniciativa e está escolhendo a ordem.";
    else if (status === "RESOLVED")
        intro.textContent = iWon ? "Você venceu a iniciativa e começa a partida." : "Seu oponente venceu a iniciativa e começa a partida.";
    modal.style.display = "flex";
}
function clearMulliganCountdown(resetDeadline = true) {
    if (activeMulliganTimer) {
        window.clearInterval(activeMulliganTimer);
        activeMulliganTimer = null;
    }
    if (resetDeadline)
        currentMulliganDeadlineAt = 0;
    const timer = document.getElementById("mulliganTimer");
    if (!timer)
        return;
    timer.style.display = "none";
    timer.classList.remove("is-danger");
}
function syncMulliganCountdown(deadlineAt) {
    const timer = document.getElementById("mulliganTimer");
    if (!timer || deadlineAt <= 0) {
        clearMulliganCountdown(deadlineAt <= 0);
        return;
    }
    currentMulliganDeadlineAt = deadlineAt;
    const render = () => {
        const remainingMs = Math.max(0, currentMulliganDeadlineAt - Date.now());
        const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
        timer.style.display = "block";
        timer.textContent = `Tempo restante: ${remaining}s`;
        timer.classList.toggle("is-danger", remaining <= 10);
        if (remainingMs <= 0 && activeMulliganTimer) {
            window.clearInterval(activeMulliganTimer);
            activeMulliganTimer = null;
        }
    };
    if (activeMulliganTimer)
        window.clearInterval(activeMulliganTimer);
    render();
    activeMulliganTimer = window.setInterval(render, 250);
}
function updateMulliganModal(hand, submitted, opponentReady) {
    const modal = document.getElementById("mulliganModal");
    const intro = document.getElementById("mulliganIntro");
    const counter = document.getElementById("mulliganCount");
    const grid = document.getElementById("mulliganGrid");
    const button = document.getElementById("mulliganConfirmButton");
    if (!modal || !intro || !counter || !grid || !button)
        return;
    for (const index of Array.from(mulliganSelectedIndexes)) {
        if (index < 0 || index >= hand.length)
            mulliganSelectedIndexes.delete(index);
    }
    const selectedCount = mulliganSelectedIndexes.size;
    intro.textContent = submitted
        ? "Mulligan confirmado. Aguardando oponente concluir a troca."
        : opponentReady
            ? "Seu oponente já confirmou. Selecione de 0 a 5 cartas para trocar."
            : "Selecione de 0 a 5 cartas da mão inicial para trocar. As cartas escolhidas vão para o fundo do deck, você compra a mesma quantidade do topo e então o baralho é embaralhado.";
    counter.textContent = `${selectedCount} carta${selectedCount === 1 ? "" : "s"} selecionada${selectedCount === 1 ? "" : "s"}`;
    button.disabled = submitted;
    button.textContent = submitted ? "Aguardando oponente..." : (selectedCount > 0 ? `Trocar ${selectedCount} carta${selectedCount === 1 ? "" : "s"}` : "Manter mão");
    grid.innerHTML = "";
    hand.forEach((cardId, index) => {
        const cardEl = buildHandCard(cardId, mulliganSelectedIndexes.has(index), submitted ? undefined : () => {
            if (mulliganSelectedIndexes.has(index))
                mulliganSelectedIndexes.delete(index);
            else if (mulliganSelectedIndexes.size < 5)
                mulliganSelectedIndexes.add(index);
            updateMulliganModal(hand, false, opponentReady);
        }, { cardId, side: "you", lane: "hand", index });
        cardEl.draggable = false;
        cardEl.ondragstart = null;
        grid.appendChild(cardEl);
    });
    modal.style.display = "flex";
}
function syncMulliganUi(state, hand) {
    const phase = String(state?.game?.phase || "");
    if (isSpectator || !slot || phase !== "MULLIGAN") {
        mulliganSubmitted = false;
        mulliganSelectedIndexes.clear();
        clearMulliganCountdown();
        hideMulliganModal();
        return;
    }
    const localDone = slot === "p1" ? !!state?.game?.p1MulliganDone : !!state?.game?.p2MulliganDone;
    const opponentDone = slot === "p1" ? !!state?.game?.p2MulliganDone : !!state?.game?.p1MulliganDone;
    const deadlineAt = Number(state?.game?.mulliganDeadlineAt || 0);
    mulliganSubmitted = localDone;
    syncMulliganCountdown(deadlineAt);
    updateMulliganModal(hand, localDone, opponentDone);
}
function submitMulliganSelection() {
    if (isSpectator || !room || currentPhase !== "MULLIGAN" || mulliganSubmitted)
        return;
    const indices = Array.from(mulliganSelectedIndexes).sort((left, right) => left - right);
    mulliganSubmitted = true;
    updateMulliganModal(currentMyHand, true, false);
    room.send("submit_mulligan", { indices });
}
function buildBackCard(side, cardId) {
    const back = document.createElement("div");
    back.className = "card handCard slotCard slotCardBack";
    if (cardId)
        back.dataset.cardId = cardId;
    const image = document.createElement("img");
    image.className = "slotCardImg";
    setThumbnailSource(image, cardBackAssetForSide(side));
    image.alt = "Carta";
    image.decoding = "async";
    image.loading = "lazy";
    back.appendChild(image);
    return back;
}
function getNewHandEntryFlags(nextCards, previousCards) {
    const previousCounts = new Map();
    for (const cardId of previousCards) {
        previousCounts.set(cardId, (previousCounts.get(cardId) || 0) + 1);
    }
    return nextCards.map((cardId) => {
        const remaining = previousCounts.get(cardId) || 0;
        if (remaining > 0) {
            previousCounts.set(cardId, remaining - 1);
            return false;
        }
        return true;
    });
}
function sameStringArray(left, right) {
    if (left.length !== right.length)
        return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index])
            return false;
    }
    return true;
}
function listRemovedCards(previousCards, nextCards) {
    const nextCounts = new Map();
    for (const cardId of nextCards)
        nextCounts.set(cardId, (nextCounts.get(cardId) || 0) + 1);
    const removed = [];
    for (const cardId of previousCards) {
        const remaining = nextCounts.get(cardId) || 0;
        if (remaining > 0) {
            nextCounts.set(cardId, remaining - 1);
            continue;
        }
        removed.push(cardId);
    }
    return removed;
}
function listAddedCards(previousCards, nextCards) {
    const previousCounts = new Map();
    for (const cardId of previousCards)
        previousCounts.set(cardId, (previousCounts.get(cardId) || 0) + 1);
    const added = [];
    for (const cardId of nextCards) {
        const remaining = previousCounts.get(cardId) || 0;
        if (remaining > 0) {
            previousCounts.set(cardId, remaining - 1);
            continue;
        }
        added.push(cardId);
    }
    return added;
}
function captureHandTransferSnapshots(containerId) {
    const container = document.getElementById(containerId);
    const snapshots = new Map();
    if (!container)
        return snapshots;
    for (const node of Array.from(container.querySelectorAll(":scope > [data-card-id]"))) {
        const el = node;
        const cardId = String(el.dataset.cardId || "").trim();
        if (!cardId)
            continue;
        const image = el.querySelector("img");
        const entry = {
            cardId,
            originRect: el.getBoundingClientRect(),
            imageSrc: String(image?.src || "")
        };
        const bucket = snapshots.get(cardId) || [];
        bucket.push(entry);
        snapshots.set(cardId, bucket);
    }
    return snapshots;
}
function takeHandTransferSnapshot(snapshots, cardId) {
    const bucket = snapshots.get(cardId);
    if (!bucket?.length)
        return null;
    const snapshot = bucket.shift() || null;
    if (!bucket.length)
        snapshots.delete(cardId);
    return snapshot;
}
function consumeRemovedHandCard(removedCounts, cardId) {
    const remaining = removedCounts.get(cardId) || 0;
    if (remaining <= 0)
        return false;
    if (remaining === 1)
        removedCounts.delete(cardId);
    else
        removedCounts.set(cardId, remaining - 1);
    return true;
}
function animateHandTransferFromSnapshot(snapshots, cardId, targetEl) {
    const snapshot = takeHandTransferSnapshot(snapshots, cardId);
    if (!snapshot || !targetEl)
        return;
    animateCardTransfer(snapshot.originRect, targetEl, { imageSrc: snapshot.imageSrc, fadeOut: false, durationMs: 280 });
}
function takeAnyHandTransferSnapshot(snapshots) {
    for (const [cardId, bucket] of snapshots) {
        if (!bucket.length)
            continue;
        const snapshot = bucket.shift() || null;
        if (!bucket.length)
            snapshots.delete(cardId);
        return snapshot;
    }
    return null;
}
function animateAnyHandTransferFromSnapshot(snapshots, targetEl) {
    const snapshot = takeAnyHandTransferSnapshot(snapshots);
    if (!snapshot || !targetEl)
        return;
    animateCardTransfer(snapshot.originRect, targetEl, { imageSrc: snapshot.imageSrc, fadeOut: false, durationMs: 280 });
}
function animateVisibleHandTransfers(snapshots, prefix, previousHand, nextHand, previousField, nextField, previousSupport, nextSupport, previousEnv, nextEnv, previousGrave, nextGrave, previousBanished, nextBanished) {
    if (!previousHand.length)
        return;
    const removedCounts = new Map();
    for (const cardId of listRemovedCards(previousHand, nextHand)) {
        removedCounts.set(cardId, (removedCounts.get(cardId) || 0) + 1);
    }
    if (!removedCounts.size)
        return;
    for (let index = 0; index < nextField.length; index += 1) {
        const cardId = String(nextField[index] || "").trim();
        if (!cardId || previousField[index] === cardId || !consumeRemovedHandCard(removedCounts, cardId))
            continue;
        animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-ally-${index} > .card`));
    }
    for (let index = 0; index < nextSupport.length; index += 1) {
        const cardId = String(nextSupport[index] || "").trim();
        if (!cardId || previousSupport[index] === cardId || !consumeRemovedHandCard(removedCounts, cardId))
            continue;
        animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-support-${index} > .card`));
    }
    if (nextEnv && nextEnv !== previousEnv && consumeRemovedHandCard(removedCounts, nextEnv)) {
        animateHandTransferFromSnapshot(snapshots, nextEnv, document.querySelector(`#${prefix}-env > .card`));
    }
    for (const cardId of listAddedCards(previousGrave, nextGrave)) {
        if (!consumeRemovedHandCard(removedCounts, cardId))
            continue;
        animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-grave > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-grave`));
    }
    for (const cardId of listAddedCards(previousBanished, nextBanished)) {
        if (!consumeRemovedHandCard(removedCounts, cardId))
            continue;
        animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-banished > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-banished`));
    }
}
function animateHiddenHandTransfers(snapshots, prefix, previousHand, nextHand, previousField, nextField, previousSupport, nextSupport, previousEnv, nextEnv, previousGrave, nextGrave, previousBanished, nextBanished) {
    let flightsRemaining = Math.max(0, previousHand.length - nextHand.length);
    if (!flightsRemaining)
        return;
    const tryAnimate = (targetEl) => {
        if (flightsRemaining <= 0)
            return;
        animateAnyHandTransferFromSnapshot(snapshots, targetEl);
        flightsRemaining -= 1;
    };
    for (let index = 0; index < nextField.length; index += 1) {
        if (!nextField[index] || previousField[index] === nextField[index])
            continue;
        tryAnimate(document.querySelector(`#${prefix}-ally-${index} > .card`));
    }
    for (let index = 0; index < nextSupport.length; index += 1) {
        if (!nextSupport[index] || previousSupport[index] === nextSupport[index])
            continue;
        tryAnimate(document.querySelector(`#${prefix}-support-${index} > .card`));
    }
    if (nextEnv && nextEnv !== previousEnv)
        tryAnimate(document.querySelector(`#${prefix}-env > .card`));
    for (let index = 0; index < listAddedCards(previousGrave, nextGrave).length; index += 1) {
        tryAnimate(document.querySelector(`#${prefix}-grave > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-grave`));
    }
    for (let index = 0; index < listAddedCards(previousBanished, nextBanished).length; index += 1) {
        tryAnimate(document.querySelector(`#${prefix}-banished > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-banished`));
    }
}
function queueLanePileFlights(zoneId, cardIds) {
    const queue = pendingLanePileFlights[zoneId];
    queue.clear();
    for (const cardId of cardIds) {
        if (!cardId)
            continue;
        queue.set(cardId, (queue.get(cardId) || 0) + 1);
    }
}
function consumeLanePileFlight(zoneId, cardId) {
    const queue = pendingLanePileFlights[zoneId];
    const remaining = queue.get(cardId) || 0;
    if (remaining <= 0)
        return false;
    if (remaining === 1)
        queue.delete(cardId);
    else
        queue.set(cardId, remaining - 1);
    return true;
}
function captureLaneTransferSnapshots(zoneIds) {
    const snapshots = new Map();
    for (const zoneId of zoneIds) {
        const zone = document.getElementById(zoneId);
        if (!zone)
            continue;
        for (const slot of Array.from(zone.children)) {
            const cardEl = slot.querySelector(":scope > .card");
            if (!cardEl)
                continue;
            const cardId = String(cardEl.dataset.cardId || "").trim();
            if (!cardId)
                continue;
            const image = cardEl.querySelector("img");
            const entry = {
                cardId,
                originRect: cardEl.getBoundingClientRect(),
                imageSrc: String(image?.src || ""),
                zoneId
            };
            const bucket = snapshots.get(cardId) || [];
            bucket.push(entry);
            snapshots.set(cardId, bucket);
        }
    }
    return snapshots;
}
function takeLaneTransferSnapshot(snapshots, preferredZoneId, cardId) {
    const bucket = snapshots.get(cardId);
    if (!bucket?.length)
        return null;
    const preferredIndex = bucket.findIndex((entry) => entry.zoneId === preferredZoneId);
    const index = preferredIndex >= 0 ? preferredIndex : 0;
    const [snapshot] = bucket.splice(index, 1);
    if (!bucket.length)
        snapshots.delete(cardId);
    return snapshot || null;
}
function animateBoardPileTransferFromSnapshot(snapshots, preferredZoneId, cardId, targetEl) {
    const snapshot = takeLaneTransferSnapshot(snapshots, preferredZoneId, cardId);
    if (!snapshot || !targetEl)
        return;
    animateCardTransfer(snapshot.originRect, targetEl, { imageSrc: snapshot.imageSrc, fadeOut: false, durationMs: 300 });
}
function animateBoardPileTransfers(snapshots, fieldZoneId, supportZoneId, previousField, nextField, previousSupport, nextSupport, previousGrave, nextGrave, previousBanished, nextBanished, graveTargetEl, banishedTargetEl) {
    const removedField = listRemovedCards(previousField, nextField);
    const removedSupport = listRemovedCards(previousSupport, nextSupport);
    if (!removedField.length && !removedSupport.length)
        return;
    const removedFieldCounts = new Map();
    for (const cardId of removedField)
        removedFieldCounts.set(cardId, (removedFieldCounts.get(cardId) || 0) + 1);
    const removedSupportCounts = new Map();
    for (const cardId of removedSupport)
        removedSupportCounts.set(cardId, (removedSupportCounts.get(cardId) || 0) + 1);
    const playTransfer = (cardId, targetEl) => {
        if (consumeRemovedHandCard(removedFieldCounts, cardId)) {
            animateBoardPileTransferFromSnapshot(snapshots, fieldZoneId, cardId, targetEl);
            return;
        }
        if (consumeRemovedHandCard(removedSupportCounts, cardId)) {
            animateBoardPileTransferFromSnapshot(snapshots, supportZoneId, cardId, targetEl);
        }
    };
    for (const cardId of listAddedCards(previousGrave, nextGrave))
        playTransfer(cardId, graveTargetEl);
    for (const cardId of listAddedCards(previousBanished, nextBanished))
        playTransfer(cardId, banishedTargetEl);
}
function getBoardCardsMovingToPiles(previousField, nextField, previousSupport, nextSupport, previousGrave, nextGrave, previousBanished, nextBanished) {
    const fieldCounts = new Map();
    for (const cardId of listRemovedCards(previousField, nextField))
        fieldCounts.set(cardId, (fieldCounts.get(cardId) || 0) + 1);
    const supportCounts = new Map();
    for (const cardId of listRemovedCards(previousSupport, nextSupport))
        supportCounts.set(cardId, (supportCounts.get(cardId) || 0) + 1);
    const field = [];
    const support = [];
    const addedToPiles = [
        ...listAddedCards(previousGrave, nextGrave),
        ...listAddedCards(previousBanished, nextBanished)
    ];
    for (const cardId of addedToPiles) {
        if (consumeRemovedHandCard(fieldCounts, cardId)) {
            field.push(cardId);
            continue;
        }
        if (consumeRemovedHandCard(supportCounts, cardId))
            support.push(cardId);
    }
    return { field, support };
}
function pileCards(side, which) {
    if (side === "you") {
        if (which === "deck")
            return currentMyDeck;
        if (which === "grave")
            return currentMyGrave;
        return currentMyBanished;
    }
    if (which === "deck")
        return currentEnemyDeck;
    if (which === "grave")
        return currentEnemyGrave;
    return currentEnemyBanished;
}
function attachedEquipCards(side, targetPos) {
    const supports = side === "you" ? currentMySupport : currentEnemySupport;
    const supportAttach = side === "you" ? currentMySupportAttach : currentEnemySupportAttach;
    const expectedTarget = targetPos == null ? -1 : targetPos;
    const out = [];
    for (let index = 0; index < supports.length; index += 1) {
        const supportCardId = String(supports[index] || "").trim();
        if (!supportCardId)
            continue;
        if (Number(supportAttach[index] ?? -2) !== expectedTarget)
            continue;
        if (getCardKind(supportCardId) !== "equip")
            continue;
        out.push(supportCardId);
    }
    return out;
}
function appendEquipAttachTag(cardEl, side, targetPos) {
    const equips = attachedEquipCards(side, targetPos);
    if (!equips.length)
        return;
    const tag = document.createElement("div");
    tag.className = "equipAttachTag";
    tag.textContent = `⚙${equips.length}`;
    tag.title = `Equipado por: ${equips.join(", ")}`;
    cardEl.appendChild(tag);
}
function getSupportCounterForSide(side, index) {
    const source = side === "you" ? currentMySupportCounters : currentEnemySupportCounters;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
function appendSupportCounterTag(cardEl, value) {
    if (!Number.isFinite(value) || value <= 0)
        return;
    const tag = document.createElement("div");
    tag.className = "equipAttachTag";
    tag.textContent = `✦${value}`;
    tag.title = `Cartas deslocadas por este efeito: ${value}`;
    cardEl.appendChild(tag);
}
function appendAllyStatsBar(cardEl, values) {
    const bar = document.createElement("div");
    bar.className = "allyStatsRow";
    const hpTag = document.createElement("div");
    hpTag.className = "allyStatTag allyStatTag--hp";
    if (values.maxHp > 0 && values.hp / values.maxHp <= 0.5)
        hpTag.classList.add("low");
    const hpIcon = document.createElement("span");
    hpIcon.className = "allyStatIcon";
    hpIcon.textContent = "❤";
    const hpValue = document.createElement("span");
    hpValue.className = "allyStatValue";
    hpValue.textContent = String(values.hp);
    hpTag.appendChild(hpIcon);
    hpTag.appendChild(hpValue);
    bar.appendChild(hpTag);
    const attackTag = document.createElement("div");
    attackTag.className = "allyStatTag allyStatTag--attack";
    const attackIcon = document.createElement("span");
    attackIcon.className = "allyStatIcon";
    attackIcon.textContent = "⚔";
    const attackValue = document.createElement("span");
    attackValue.className = "allyStatValue";
    attackValue.textContent = String(values.attack);
    attackTag.appendChild(attackIcon);
    attackTag.appendChild(attackValue);
    bar.appendChild(attackTag);
    const resistanceTag = document.createElement("div");
    resistanceTag.className = "allyStatTag allyStatTag--resistance";
    const resistanceIcon = document.createElement("span");
    resistanceIcon.className = "allyStatIcon";
    resistanceIcon.textContent = "🛡";
    const resistanceValue = document.createElement("span");
    resistanceValue.className = "allyStatValue";
    resistanceValue.textContent = String(values.resistance);
    resistanceTag.appendChild(resistanceIcon);
    resistanceTag.appendChild(resistanceValue);
    bar.appendChild(resistanceTag);
    cardEl.appendChild(bar);
}
function appendChosenStatsBar(cardEl, values) {
    const bar = document.createElement("div");
    bar.className = "allyStatsRow chosenStatsRow";
    const hpTag = document.createElement("div");
    hpTag.className = "allyStatTag allyStatTag--hp";
    if (values.maxHp > 0 && values.hp / values.maxHp <= 0.5)
        hpTag.classList.add("low");
    const hpIcon = document.createElement("span");
    hpIcon.className = "allyStatIcon";
    hpIcon.textContent = "❤";
    const hpValue = document.createElement("span");
    hpValue.className = "allyStatValue";
    hpValue.textContent = String(values.hp);
    hpTag.appendChild(hpIcon);
    hpTag.appendChild(hpValue);
    bar.appendChild(hpTag);
    if (Number.isFinite(values.resistance) && values.resistance > 0) {
        const resistanceTag = document.createElement("div");
        resistanceTag.className = "allyStatTag allyStatTag--resistance";
        const resistanceIcon = document.createElement("span");
        resistanceIcon.className = "allyStatIcon";
        resistanceIcon.textContent = "🛡";
        const resistanceValue = document.createElement("span");
        resistanceValue.className = "allyStatValue";
        resistanceValue.textContent = String(values.resistance);
        resistanceTag.appendChild(resistanceIcon);
        resistanceTag.appendChild(resistanceValue);
        bar.appendChild(resistanceTag);
    }
    cardEl.appendChild(bar);
}
function pileLabel(which) {
    if (which === "deck")
        return "Baralho";
    if (which === "grave")
        return "Cemitério";
    return "Deslocadas";
}
function renderPileModal() {
    const modal = document.getElementById("pileModal");
    const title = document.getElementById("pileTitle");
    const grid = document.getElementById("pileGrid");
    if (!modal || !title || !grid)
        return;
    const sideLabel = activePileSide === "you" ? "Você" : "Oponente";
    title.textContent = `${sideLabel} • ${pileLabel(activePileWhich)}`;
    grid.innerHTML = "";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(63px, 1fr))";
    grid.style.gap = "8px";
    const box = modal.querySelector(".modalBox");
    if (!box)
        return;
    let tabs = box.querySelector("#pileTabs");
    if (!tabs) {
        tabs = document.createElement("div");
        tabs.id = "pileTabs";
        tabs.style.display = "flex";
        tabs.style.gap = "8px";
        tabs.style.margin = "0 0 10px 0";
        const header = title.parentElement;
        if (header && header.nextElementSibling)
            box.insertBefore(tabs, header.nextElementSibling);
        else
            box.appendChild(tabs);
    }
    tabs.innerHTML = "";
    for (const which of ["deck", "grave", "banished"]) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "btn";
        tab.textContent = pileLabel(which);
        if (which === activePileWhich)
            tab.classList.add("primary");
        tab.onclick = () => {
            activePileWhich = which;
            renderPileModal();
        };
        tabs.appendChild(tab);
    }
    const cards = pileCards(activePileSide, activePileWhich);
    if (!cards.length) {
        const empty = document.createElement("div");
        empty.style.opacity = "0.75";
        empty.style.fontSize = "12px";
        empty.textContent = "Sem cartas nesta pilha.";
        grid.appendChild(empty);
        return;
    }
    for (let index = cards.length - 1; index >= 0; index -= 1) {
        const cardId = String(cards[index] || "").trim();
        if (!cardId)
            continue;
        const card = resolveCard(cardId);
        const hideFace = activePileWhich === "deck" && !isMatchFinished;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "card slotCard";
        button.dataset.cardId = cardId;
        button.style.width = "63px";
        button.style.height = "88px";
        button.style.cursor = "default";
        const image = document.createElement("img");
        image.className = "slotCardImg";
        setThumbnailSource(image, hideFace ? cardBackAssetForSide(activePileSide) : (card?.img || CARD_BACK_ASSET));
        image.alt = hideFace ? "Carta virada" : (card?.name || cardId);
        button.appendChild(image);
        button.onmouseenter = () => {
            if (hideFace)
                return;
            setHoveredInspector({ cardId, side: activePileSide, lane: activePileWhich });
        };
        button.onmouseleave = () => setHoveredInspector(null);
        if (!hideFace)
            bindMobileCardInspect(button, { cardId, side: activePileSide, lane: activePileWhich });
        grid.appendChild(button);
    }
}
function renderVisiblePileSlot(slotId, countId, cards, hideFace) {
    const slotEl = document.getElementById(slotId);
    const countEl = document.getElementById(countId);
    if (countEl)
        countEl.textContent = String(cards.length);
    if (!slotEl)
        return;
    for (const old of Array.from(slotEl.querySelectorAll(":scope > .deckVisualCard")))
        old.remove();
    if (!cards.length)
        return;
    const side = slotId.startsWith("you") ? "you" : "ai";
    const topCardId = String(cards[cards.length - 1] || "").trim();
    const topCard = resolveCard(topCardId);
    for (let layer = 0; layer < Math.min(3, cards.length); layer += 1) {
        const cardEl = document.createElement("div");
        cardEl.className = "card slotCard deckVisualCard";
        cardEl.dataset.cardId = topCardId;
        cardEl.style.width = "100%";
        cardEl.style.height = "100%";
        cardEl.style.margin = "0";
        cardEl.style.position = "absolute";
        cardEl.style.left = `${layer * 2}px`;
        cardEl.style.top = `${layer * 2}px`;
        cardEl.style.zIndex = String(10 + layer);
        const image = document.createElement("img");
        image.className = "slotCardImg";
        setThumbnailSource(image, hideFace ? cardBackAssetForSide(side) : (topCard?.img || CARD_BACK_ASSET));
        image.alt = hideFace ? "Carta virada" : (topCard?.name || topCardId || "Carta");
        cardEl.appendChild(image);
        if (layer === Math.min(3, cards.length) - 1 && !hideFace) {
            const lane = slotId.includes("grave") ? "grave" : (slotId.includes("ban") ? "banished" : "deck");
            cardEl.onmouseenter = () => setHoveredInspector({ cardId: topCardId, side, lane });
            cardEl.onmouseleave = () => setHoveredInspector(null);
            bindMobileCardInspect(cardEl, { cardId: topCardId, side, lane });
        }
        slotEl.appendChild(cardEl);
    }
}
function showPile(side, which) {
    activePileSide = side;
    activePileWhich = which;
    const modal = document.getElementById("pileModal");
    if (!modal)
        return;
    modal.style.display = "flex";
    renderPileModal();
}
function hidePile() {
    const modal = document.getElementById("pileModal");
    if (!modal)
        return;
    modal.style.display = "none";
}
function bindPileSlots() {
    for (const side of ["you", "ai"]) {
        const deckSlot = document.getElementById(`${side}-deck`);
        const graveSlot = document.getElementById(`${side}-grave`);
        const banSlot = document.getElementById(`${side}-banished`) || document.getElementById(`${side}-ban`);
        if (deckSlot)
            deckSlot.onclick = () => showPile(side, "deck");
        if (graveSlot)
            graveSlot.onclick = () => showPile(side, "grave");
        if (banSlot)
            banSlot.onclick = () => showPile(side, "banished");
    }
}
function clearChoiceBoardHighlights() {
    for (const element of activeChoiceHighlightedElements)
        element.classList.remove("choiceBoardHighlight");
    activeChoiceHighlightedElements = [];
}
function resolveChoiceHighlightElement(option) {
    const serverSide = String(option?.side || "");
    const side = sideFromServerSlot(serverSide);
    const lane = String(option?.lane || "").toLowerCase();
    const pos = Number(option?.pos);
    if (!side)
        return null;
    if ((lane === "field" || lane === "ally") && Number.isInteger(pos) && pos >= 0) {
        return document.getElementById(`${side}-ally-${pos}`);
    }
    if (lane === "support" && Number.isInteger(pos) && pos >= 0) {
        return document.getElementById(`${side}-support-${pos}`);
    }
    if (lane === "leader") {
        return document.getElementById(side === "you" ? "you-leader" : "ai-leader");
    }
    return null;
}
function applyChoiceBoardHighlights(payload) {
    clearChoiceBoardHighlights();
    const seen = new Set();
    for (const option of Array.isArray(payload?.options) ? payload.options : []) {
        if (option?.disabled)
            continue;
        const element = resolveChoiceHighlightElement(option);
        if (!element || seen.has(element))
            continue;
        seen.add(element);
        element.classList.add("choiceBoardHighlight");
        activeChoiceHighlightedElements.push(element);
    }
}
function hideChoiceRestoreDock() {
    const dock = document.getElementById("cardChoiceRestoreDock");
    if (dock)
        dock.style.display = "none";
}
function showChoiceRestoreDock() {
    const dock = document.getElementById("cardChoiceRestoreDock");
    const title = document.getElementById("cardChoiceRestoreTitle");
    if (!dock || !activeChoiceId)
        return;
    if (title)
        title.textContent = activeChoiceTitleText || "Escolha pendente";
    dock.style.display = "block";
}
function minimizeCardChoiceModal() {
    const modal = document.getElementById("cardChoiceModal");
    if (!modal || !activeChoiceId)
        return;
    activeChoiceIsMinimized = true;
    modal.style.display = "none";
    showChoiceRestoreDock();
}
function restoreCardChoiceModal() {
    const modal = document.getElementById("cardChoiceModal");
    if (!modal || !activeChoiceId)
        return;
    activeChoiceIsMinimized = false;
    hideChoiceRestoreDock();
    modal.style.display = "flex";
}
function hideCardChoiceModal(sendCancel = true) {
    const modal = document.getElementById("cardChoiceModal");
    if (!modal)
        return;
    modal.style.display = "none";
    activeChoiceIsMinimized = false;
    hideChoiceRestoreDock();
    clearChoiceBoardHighlights();
    if (activeChoiceTimer) {
        window.clearInterval(activeChoiceTimer);
        activeChoiceTimer = null;
    }
    const countdown = document.getElementById("cardChoiceCountdown");
    if (countdown) {
        countdown.style.display = "none";
        countdown.classList.remove("is-danger");
    }
    const restoreCountdown = document.getElementById("cardChoiceRestoreCountdown");
    if (restoreCountdown) {
        restoreCountdown.classList.remove("is-danger");
    }
    const grid = document.getElementById("cardChoiceGrid");
    if (grid)
        grid.innerHTML = "";
    if (sendCancel && room && activeChoiceId) {
        room.send("effect_choice_submit", { choiceId: activeChoiceId, optionId: null });
    }
    activeChoiceId = null;
}
function startCountdown(containerId, valueId, timeoutMs, store) {
    const container = document.getElementById(containerId);
    const valueEl = document.getElementById(valueId);
    if (!container || !valueEl || timeoutMs <= 0)
        return;
    container.style.display = "block";
    const restoreContainer = store === "choice" ? document.getElementById("cardChoiceRestoreCountdown") : null;
    const restoreValueEl = store === "choice" ? document.getElementById("cardChoiceRestoreCountdownValue") : null;
    const endAt = Date.now() + timeoutMs;
    const render = () => {
        const remainingMs = Math.max(0, endAt - Date.now());
        const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
        valueEl.textContent = String(remaining);
        container.classList.toggle("is-danger", remaining <= 10);
        if (restoreContainer && restoreValueEl) {
            restoreValueEl.textContent = String(remaining);
            restoreContainer.classList.toggle("is-danger", remaining <= 10);
        }
        if (remainingMs <= 0) {
            if (store === "choice" && activeChoiceTimer) {
                window.clearInterval(activeChoiceTimer);
                activeChoiceTimer = null;
            }
            if (store === "waiting" && activeWaitingTimer) {
                window.clearInterval(activeWaitingTimer);
                activeWaitingTimer = null;
            }
        }
    };
    render();
    const intervalId = window.setInterval(render, 250);
    if (store === "choice") {
        if (activeChoiceTimer)
            window.clearInterval(activeChoiceTimer);
        activeChoiceTimer = intervalId;
    }
    else {
        if (activeWaitingTimer)
            window.clearInterval(activeWaitingTimer);
        activeWaitingTimer = intervalId;
    }
}
function showChoiceWaitingModal(payload) {
    const modal = document.getElementById("choiceWaitingModal");
    const title = document.getElementById("choiceWaitingTitle");
    const text = document.getElementById("choiceWaitingText");
    if (!modal || !title || !text)
        return;
    title.textContent = "Seu oponente está escolhendo";
    const shouldReveal = (typeof isSpectator !== "undefined" && isSpectator) || payload?.reveal === true;
    text.textContent = shouldReveal
        ? String(payload?.title || "Aguarde a decisão para a partida continuar.")
        : "Aguarde a decisão para a partida continuar.";
    modal.style.display = "flex";
    startCountdown("choiceWaitingCountdown", "choiceWaitingCountdownValue", Number(payload?.timeoutMs || 0), "waiting");
}
function createChoiceDuelPanel(payload) {
    const attackerId = String(payload?.attackerId || "").trim();
    const targetCardId = String(payload?.targetCardId || "").trim();
    const attackerName = String(payload?.attackerName || attackerId || "Atacante").trim();
    const targetName = String(payload?.targetName || targetCardId || "Alvo").trim();
    const attackerAttack = Number(payload?.attackerAttack);
    const targetResistance = Number(payload?.targetResistance);
    const targetHp = Number(payload?.targetHp);
    const targetMaxHp = Number(payload?.targetMaxHp);
    if (!attackerId && !targetCardId)
        return null;
    const panel = document.createElement("div");
    panel.style.display = "grid";
    panel.style.gap = "8px";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(255,255,255,.14)";
    panel.style.borderRadius = "10px";
    panel.style.background = "rgba(255,255,255,.04)";
    const title = document.createElement("div");
    title.textContent = "Combate Atual";
    title.style.fontSize = "12px";
    title.style.fontWeight = "700";
    title.style.opacity = "0.95";
    panel.appendChild(title);
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto 1fr";
    row.style.gap = "8px";
    row.style.alignItems = "start";
    const buildMini = (cardId, name, tone) => {
        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gap = "4px";
        wrap.style.justifyItems = "center";
        const card = resolveCard(cardId);
        const thumb = document.createElement("img");
        setThumbnailSource(thumb, card?.img || CARD_BACK_ASSET);
        thumb.alt = name || cardId || (tone === "atk" ? "Atacante" : "Alvo");
        thumb.style.width = "72px";
        thumb.style.height = "100px";
        thumb.style.objectFit = "cover";
        thumb.style.borderRadius = "8px";
        thumb.style.border = tone === "atk"
            ? "1px solid rgba(248,113,113,.55)"
            : "1px solid rgba(125,211,252,.55)";
        thumb.style.boxShadow = "0 6px 14px rgba(0,0,0,.35)";
        const label = document.createElement("div");
        label.textContent = name || cardId || (tone === "atk" ? "Atacante" : "Alvo");
        label.style.fontSize = "11px";
        label.style.lineHeight = "1.15";
        label.style.textAlign = "center";
        label.style.maxWidth = "96px";
        label.style.opacity = "0.95";
        wrap.appendChild(thumb);
        wrap.appendChild(label);
        return wrap;
    };
    row.appendChild(buildMini(attackerId, attackerName, "atk"));
    const versus = document.createElement("div");
    versus.textContent = "x";
    versus.style.alignSelf = "center";
    versus.style.fontWeight = "800";
    versus.style.opacity = "0.9";
    row.appendChild(versus);
    row.appendChild(buildMini(targetCardId, targetName, "def"));
    panel.appendChild(row);
    const hasRiskLine = Number.isFinite(attackerAttack) || Number.isFinite(targetResistance);
    const hasHpLine = Number.isFinite(targetHp) || Number.isFinite(targetMaxHp);
    if (hasRiskLine || hasHpLine) {
        const stats = document.createElement("div");
        stats.style.display = "flex";
        stats.style.flexWrap = "wrap";
        stats.style.gap = "6px";
        stats.style.justifyContent = "center";
        if (hasRiskLine) {
            const risk = document.createElement("div");
            risk.style.padding = "3px 8px";
            risk.style.borderRadius = "999px";
            risk.style.border = "1px solid rgba(255,255,255,.18)";
            risk.style.background = "rgba(15,23,42,.72)";
            risk.style.fontSize = "11px";
            risk.style.fontWeight = "700";
            risk.textContent = `ATK ${Number.isFinite(attackerAttack) ? attackerAttack : "?"} x RES ${Number.isFinite(targetResistance) ? targetResistance : "?"}`;
            stats.appendChild(risk);
        }
        if (hasHpLine) {
            const hp = document.createElement("div");
            hp.style.padding = "3px 8px";
            hp.style.borderRadius = "999px";
            hp.style.border = "1px solid rgba(255,255,255,.18)";
            hp.style.background = "rgba(15,23,42,.72)";
            hp.style.fontSize = "11px";
            hp.style.fontWeight = "700";
            hp.textContent = `Vida alvo ${Number.isFinite(targetHp) ? targetHp : "?"}/${Number.isFinite(targetMaxHp) ? targetMaxHp : "?"}`;
            stats.appendChild(hp);
        }
        panel.appendChild(stats);
    }
    return panel;
}
function createCounteredCardPanel(payload) {
    const cardId = String(payload?.activatedCardId || "").trim();
    if (!cardId)
        return null;
    const card = resolveCard(cardId);
    const panel = document.createElement("div");
    panel.style.display = "grid";
    panel.style.gridTemplateColumns = "64px minmax(0, 1fr)";
    panel.style.gap = "10px";
    panel.style.alignItems = "center";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(248,113,113,.55)";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(127,29,29,.22)";
    const image = document.createElement("img");
    setThumbnailSource(image, card?.img || CARD_BACK_ASSET);
    image.alt = card?.name || cardId;
    image.style.width = "64px";
    image.style.height = "88px";
    image.style.objectFit = "cover";
    image.style.borderRadius = "6px";
    image.style.border = "1px solid rgba(255,255,255,.22)";
    panel.appendChild(image);
    const copy = document.createElement("div");
    copy.style.display = "grid";
    copy.style.gap = "3px";
    const label = document.createElement("div");
    label.textContent = "Carta a responder";
    label.style.fontSize = "11px";
    label.style.fontWeight = "700";
    label.style.textTransform = "uppercase";
    label.style.opacity = "0.85";
    const name = document.createElement("div");
    name.textContent = card?.name || cardId;
    name.style.fontSize = "14px";
    name.style.fontWeight = "700";
    const description = document.createElement("div");
    description.textContent = String(card?.text || card?.descricao || "Anule esta magia ou truque antes que o efeito seja resolvido.");
    description.style.fontSize = "12px";
    description.style.lineHeight = "1.25";
    description.style.opacity = "0.92";
    copy.append(label, name, description);
    panel.appendChild(copy);
    return panel;
}
function hideChoiceWaitingModal() {
    const modal = document.getElementById("choiceWaitingModal");
    if (modal)
        modal.style.display = "none";
    if (activeWaitingTimer) {
        window.clearInterval(activeWaitingTimer);
        activeWaitingTimer = null;
    }
    const countdown = document.getElementById("choiceWaitingCountdown");
    if (countdown) {
        countdown.style.display = "none";
        countdown.classList.remove("is-danger");
    }
}
function showEffectChoiceModal(payload) {
    const modal = document.getElementById("cardChoiceModal");
    const title = document.getElementById("cardChoiceTitle");
    const grid = document.getElementById("cardChoiceGrid");
    if (!modal || !title || !grid)
        return;
    const options = Array.isArray(payload?.options) ? payload.options : [];
    const isMobileChoiceLayout = window.innerWidth <= 980;
    const denseChoiceCards = options.length >= 12;
    const choiceCardWidth = denseChoiceCards ? 68 : 72;
    const choiceCardHeight = denseChoiceCards ? 94 : 100;
    activeChoiceId = String(payload?.choiceId || "");
    activeChoiceTitleText = String(payload?.title || "Escolha pendente");
    title.textContent = activeChoiceTitleText;
    activeChoiceIsMinimized = false;
    hideChoiceRestoreDock();
    hideChoiceWaitingModal();
    applyChoiceBoardHighlights(payload);
    grid.innerHTML = "";
    grid.style.display = "block";
    const layout = document.createElement("div");
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = isMobileChoiceLayout ? "1fr" : "minmax(0, 1fr) minmax(180px, 220px)";
    layout.style.gap = "10px";
    layout.style.alignItems = "start";
    const choicesWrap = document.createElement("div");
    choicesWrap.style.display = "grid";
    choicesWrap.style.gap = "10px";
    const previewWrap = document.createElement("div");
    previewWrap.style.display = "grid";
    previewWrap.style.gap = "6px";
    previewWrap.style.alignContent = "start";
    previewWrap.style.minWidth = "0";
    const previewImg = document.createElement("img");
    previewImg.style.width = "100%";
    previewImg.style.maxWidth = window.innerWidth <= 980 ? "160px" : "220px";
    previewImg.style.borderRadius = "8px";
    previewImg.style.border = "1px solid rgba(255,255,255,.16)";
    previewImg.src = asAssetPath(CARD_BACK_ASSET);
    previewImg.alt = "Prévia";
    previewImg.style.filter = "none";
    previewImg.style.justifySelf = "center";
    const previewMeta = document.createElement("div");
    previewMeta.style.fontSize = "13px";
    previewMeta.style.opacity = "0.9";
    previewMeta.style.whiteSpace = "pre-line";
    previewMeta.textContent = "Passe o mouse em uma opção para pré-visualizar.";
    const attackerSummary = buildChoiceAttackerSummary(payload);
    if (attackerSummary) {
        const infoBox = document.createElement("div");
        infoBox.style.padding = "10px 12px";
        infoBox.style.border = "1px solid rgba(255,255,255,.14)";
        infoBox.style.borderRadius = "10px";
        infoBox.style.background = "rgba(255,255,255,.04)";
        infoBox.style.fontSize = "13px";
        infoBox.style.lineHeight = "1.35";
        infoBox.style.whiteSpace = "pre-line";
        infoBox.textContent = attackerSummary;
        previewWrap.appendChild(infoBox);
    }
    const duelPanel = createChoiceDuelPanel(payload);
    const counteredCardPanel = createCounteredCardPanel(payload);
    const timeoutMs = Number(payload?.timeoutMs || 0);
    if (timeoutMs > 0) {
        const seconds = Math.max(1, Math.floor(timeoutMs / 1000));
        const timeoutInfo = document.createElement("div");
        timeoutInfo.style.fontSize = "12px";
        timeoutInfo.style.opacity = "0.95";
        timeoutInfo.textContent = `⏱ Você tem ${seconds}s para escolher. Após isso, o jogo escolhe aleatoriamente.`;
        previewWrap.appendChild(timeoutInfo);
    }
    startCountdown("cardChoiceCountdown", "cardChoiceCountdownValue", timeoutMs, "choice");
    if (!isMobileChoiceLayout) {
        previewWrap.appendChild(previewImg);
        previewWrap.appendChild(previewMeta);
    }
    const isMultiSelect = payload?.multiSelect === true;
    const selectedOptionIds = new Set();
    const minSelections = Math.max(0, Number(payload?.minSelections || 0));
    const rawMaxSelections = Number(payload?.maxSelections || 0);
    const hasMaxSelections = Number.isFinite(rawMaxSelections) && rawMaxSelections > 0;
    let submitButton = null;
    const updateSubmitState = () => {
        if (!submitButton)
            return;
        const count = selectedOptionIds.size;
        submitButton.disabled = count < minSelections;
        submitButton.textContent = `${String(payload?.submitLabel || "Confirmar")} (${count})`;
    };
    if (isMultiSelect) {
        submitButton = document.createElement("button");
        submitButton.type = "button";
        submitButton.className = "primary";
        submitButton.style.marginTop = "8px";
        submitButton.onclick = () => {
            if (!room || !activeChoiceId)
                return;
            room.send("effect_choice_submit", { choiceId: activeChoiceId, optionId: Array.from(selectedOptionIds).join("|") });
            hideCardChoiceModal(false);
        };
        updateSubmitState();
        previewWrap.appendChild(submitButton);
    }
    const hasSide = options.some((option) => option?.side != null);
    const sideGroups = hasSide
        ? [
            { key: "you", label: "Seu", options: options.filter((o) => sideFromServerSlot(String(o?.side || "")) === "you") },
            { key: "ai", label: "Oponente", options: options.filter((o) => sideFromServerSlot(String(o?.side || "")) === "ai") },
            { key: "other", label: "Outros", options: options.filter((o) => !["you", "ai"].includes(String(sideFromServerSlot(String(o?.side || "")) || ""))) }
        ]
        : [{ key: "all", label: "Opções", options }];
    for (const group of sideGroups) {
        if (!group.options.length)
            continue;
        const groupTitle = document.createElement("div");
        groupTitle.textContent = group.label;
        groupTitle.style.fontSize = "12px";
        groupTitle.style.fontWeight = "700";
        groupTitle.style.opacity = "0.9";
        choicesWrap.appendChild(groupTitle);
        const groupGrid = document.createElement("div");
        groupGrid.style.display = "grid";
        groupGrid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${choiceCardWidth}px, 1fr))`;
        groupGrid.style.gap = "8px";
        for (const option of group.options) {
            const item = document.createElement("div");
            item.style.display = "grid";
            item.style.gap = "4px";
            item.style.alignContent = "start";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "card slotCard";
            button.style.width = `${choiceCardWidth}px`;
            button.style.height = `${choiceCardHeight}px`;
            const disabled = !!option?.disabled;
            button.style.cursor = disabled ? "not-allowed" : "pointer";
            if (disabled)
                button.style.opacity = "0.45";
            button.disabled = disabled;
            if (disabled)
                button.style.pointerEvents = "none";
            const visual = getChoiceOptionVisual(option, payload);
            const cardId = visual.cardId || String(option?.cardId || option?.label || "");
            if (cardId)
                button.dataset.cardId = cardId;
            const card = resolveCard(cardId);
            button.classList.toggle("choiceCardMuted", visual.muted);
            if (card?.img) {
                const image = document.createElement("img");
                image.className = "slotCardImg";
                setThumbnailSource(image, card.img);
                image.alt = card.name || cardId;
                button.appendChild(image);
            }
            else {
                const fallback = document.createElement("div");
                fallback.className = "slotCardFallback";
                fallback.textContent = String(option?.label || "Escolher");
                button.appendChild(fallback);
            }
            button.title = disabled
                ? String(option?.disabledReason || option?.label || "Indisponível")
                : String(option?.label || cardId || "Escolher");
            button.onmouseenter = () => {
                if (!cardId)
                    return;
                setInspector(cardId);
                setThumbnailSource(previewImg, card?.img || CARD_BACK_ASSET);
                previewImg.style.filter = visual.muted ? "grayscale(1) saturate(0.15) contrast(1.05) brightness(0.92)" : "none";
                previewMeta.textContent = [String(option?.description || option?.label || "").trim(), cardPreviewDetails(cardId, card, false, false)].filter(Boolean).join("\n\n");
            };
            if (cardId)
                bindMobileCardInspect(item, cardId);
            button.onclick = () => {
                if (disabled)
                    return;
                if (!room || !activeChoiceId)
                    return;
                if (isMultiSelect) {
                    const currentId = String(option?.id || "");
                    if (!currentId)
                        return;
                    if (selectedOptionIds.has(currentId))
                        selectedOptionIds.delete(currentId);
                    else {
                        if (hasMaxSelections && selectedOptionIds.size >= rawMaxSelections)
                            return;
                        selectedOptionIds.add(currentId);
                    }
                    const selected = selectedOptionIds.has(currentId);
                    button.classList.toggle("selected", selected);
                    button.style.outline = selected ? "2px solid #ffd54f" : "";
                    button.style.outlineOffset = selected ? "2px" : "";
                    updateSubmitState();
                    return;
                }
                room.send("effect_choice_submit", { choiceId: activeChoiceId, optionId: String(option?.id || "") });
                hideCardChoiceModal(false);
            };
            item.appendChild(button);
            const optionText = document.createElement("div");
            optionText.style.fontSize = denseChoiceCards ? "10px" : "11px";
            optionText.style.lineHeight = "1.2";
            optionText.style.opacity = "0.95";
            optionText.style.minHeight = denseChoiceCards ? "22px" : "24px";
            optionText.style.whiteSpace = "pre-line";
            optionText.textContent = String(option?.description || option?.label || "");
            item.appendChild(optionText);
            groupGrid.appendChild(item);
        }
        choicesWrap.appendChild(groupGrid);
    }
    if (duelPanel) {
        duelPanel.style.marginTop = "10px";
        choicesWrap.appendChild(duelPanel);
    }
    if (counteredCardPanel)
        choicesWrap.appendChild(counteredCardPanel);
    if (isMobileChoiceLayout) {
        layout.style.gridTemplateColumns = "1fr";
        previewWrap.style.order = "-1";
    }
    layout.appendChild(choicesWrap);
    layout.appendChild(previewWrap);
    grid.appendChild(layout);
    modal.style.display = "flex";
}
function renderDeckSlot(slotId, countId, total) {
    const slotEl = document.getElementById(slotId);
    const countEl = document.getElementById(countId);
    if (countEl)
        countEl.textContent = String(Math.max(0, Number(total || 0)));
    if (!slotEl)
        return;
    for (const old of Array.from(slotEl.querySelectorAll(":scope > .deckVisualCard")))
        old.remove();
    if (Number(total || 0) <= 0)
        return;
    const side = slotId === "you-deck" ? "you" : "ai";
    const back = document.createElement("div");
    back.className = "card slotCard slotCardBack deckVisualCard";
    back.style.width = "100%";
    back.style.height = "100%";
    back.style.margin = "0";
    const image = document.createElement("img");
    image.className = "slotCardImg";
    setThumbnailSource(image, cardBackAssetForSide(side));
    image.alt = "Baralho";
    back.appendChild(image);
    slotEl.appendChild(back);
}
function renderPileCounts(prefix, data) {
    const graveCards = asStringArray(data?.grave);
    const banCards = asStringArray(data?.banished || data?.ban);
    const deckCards = asStringArray(data?.deck);
    const previousGrave = prefix === "you" ? currentMyGrave : currentEnemyGrave;
    const previousBanished = prefix === "you" ? currentMyBanished : currentEnemyBanished;
    const graveCount = graveCards.length;
    const banCount = banCards.length;
    const deckCount = deckCards.length;
    const graveEl = document.getElementById(`${prefix}GraveCount`);
    const banEl = document.getElementById(`${prefix}BanCount`);
    if (graveEl)
        graveEl.textContent = String(Math.max(0, graveCount));
    if (banEl)
        banEl.textContent = String(Math.max(0, banCount));
    renderDeckSlot(prefix === "you" ? "you-deck" : "ai-deck", prefix === "you" ? "youDeckCount" : "aiDeckCount", deckCount);
    renderVisiblePileSlot(`${prefix}-grave`, `${prefix}GraveCount`, graveCards, false);
    renderVisiblePileSlot(`${prefix}-banished`, `${prefix}BanCount`, banCards, false);
    animatePileEntryIfNeeded(`${prefix}-grave`, previousGrave, graveCards);
    animatePileEntryIfNeeded(`${prefix}-banished`, previousBanished, banCards);
}
function getFirstEmptyFieldPos(field) {
    for (let index = 0; index < 5; index += 1) {
        if (!field[index])
            return index;
    }
    return -1;
}
function tryPlayCard(cardId, targetPos) {
    if (!room || !isMyTurn || currentPhase !== "PREP")
        return;
    if (!cardId)
        return;
    const cardKind = getCardKind(cardId);
    const lane = laneForCard(cardId);
    if (lane === "env") {
        room.send("play_card", { cardId, cardKind });
        return;
    }
    const laneState = lane === "field" ? currentMyField : currentMySupport;
    if (typeof targetPos === "number") {
        room.send("play_card", { cardId, targetPos, cardKind });
        return;
    }
    const firstEmpty = getFirstEmptyFieldPos(laneState);
    if (firstEmpty >= 0)
        room.send("play_card", { cardId, targetPos: firstEmpty, cardKind });
    else if (lane === "field")
        room.send("play_card", { cardId, cardKind });
}
function renderEnvSlot(slotId, envCardId, allowDrop) {
    const slotEl = document.getElementById(slotId);
    if (!slotEl)
        return;
    const side = slotId === "you-env" ? "you" : "ai";
    for (const oldCard of Array.from(slotEl.querySelectorAll(":scope > .card")))
        oldCard.remove();
    slotEl.classList.remove("dropTarget");
    slotEl.ondragenter = null;
    slotEl.ondragover = null;
    slotEl.ondragleave = null;
    slotEl.ondrop = null;
    if (allowDrop) {
        slotEl.ondragenter = (event) => {
            event.preventDefault();
            if (!isMyTurn || currentPhase !== "PREP")
                return;
            const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
            if (!draggedCardId || laneForCard(draggedCardId) !== "env")
                return;
            slotEl.classList.add("dropTarget");
        };
        slotEl.ondragover = (event) => {
            event.preventDefault();
            if (!isMyTurn || currentPhase !== "PREP")
                return;
            const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
            if (!draggedCardId || laneForCard(draggedCardId) !== "env")
                return;
            slotEl.classList.add("dropTarget");
        };
        slotEl.ondragleave = () => slotEl.classList.remove("dropTarget");
        slotEl.ondrop = (event) => {
            event.preventDefault();
            slotEl.classList.remove("dropTarget");
            if (!isMyTurn || currentPhase !== "PREP")
                return;
            const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
            if (!draggedCardId || laneForCard(draggedCardId) !== "env")
                return;
            selectedHandCardId = draggedCardId;
            if (view.selectedCardEl)
                view.selectedCardEl.textContent = selectedHandCardId;
            tryPlayCard(draggedCardId);
        };
    }
    const cardId = String(envCardId || "").trim();
    if (!cardId)
        return;
    const cardEl = buildHandCard(cardId, false, undefined, { cardId, side, lane: "env" });
    cardEl.className = "card slotCard";
    cardEl.style.width = "100%";
    cardEl.style.height = "100%";
    cardEl.style.margin = "0";
    slotEl.onmousemove = () => setHoveredInspector({ cardId, side, lane: "env" });
    slotEl.onmouseleave = () => setHoveredInspector(null);
    slotEl.onclick = () => {
        const target = { cardId, side, lane: "env" };
        setInspector(target);
    };
    slotEl.appendChild(cardEl);
}
function renderSideHand(containerId, cards, selectable) {
    const container = document.getElementById(containerId);
    if (!container)
        return;
    const previousCards = previousHandCards[containerId] || [];
    container.innerHTML = "";
    if (!cards.length) {
        previousHandCards[containerId] = [];
        container.innerHTML = `<div style="opacity:.7;font-size:12px;padding:4px">—</div>`;
        return;
    }
    const newEntryFlags = selectable
        ? getNewHandEntryFlags(cards, previousCards)
        : cards.map((_, index) => index >= previousCards.length);
    let renderedIndex = 0;
    for (const cardId of cards) {
        if (selectable) {
            const selected = cardId === selectedHandCardId;
            const cardEl = buildHandCard(cardId, selected, () => {
                setInspector({ cardId, side: "you", lane: "hand" });
                selectedHandCardId = cardId;
                if (view.selectedCardEl)
                    view.selectedCardEl.textContent = selectedHandCardId;
                if (room && isMyTurn && currentPhase === "PREP") {
                    tryPlayCard(cardId);
                    return;
                }
                renderSideHand("youHand", cards, true);
            }, { cardId, side: "you", lane: "hand" });
            container.appendChild(cardEl);
            if (newEntryFlags[renderedIndex])
                animateEl(cardEl, "anim-draw");
            renderedIndex += 1;
            continue;
        }
        const backCardEl = buildBackCard("ai");
        backCardEl.dataset.cardId = cardId;
        container.appendChild(backCardEl);
        if (newEntryFlags[renderedIndex])
            animateEl(backCardEl, "anim-draw");
        renderedIndex += 1;
    }
    previousHandCards[containerId] = cards.slice();
    queueHandStackLayout(containerId);
}
function applyHandStackLayout(containerId) {
    const container = document.getElementById(containerId);
    if (!container)
        return;
    handStackLayoutFrames[containerId] = 0;
    container.classList.remove("handStacked");
    container.style.removeProperty("--hand-overlap");
    if (!window.matchMedia("(max-width: 980px) and (orientation: portrait) and (pointer: coarse)").matches)
        return;
    const cards = Array.from(container.querySelectorAll(":scope > .handCard"));
    if (cards.length <= 1)
        return;
    const parent = container.parentElement;
    if (!parent)
        return;
    const availableWidth = Math.max(parent.getBoundingClientRect().width - 16, 1);
    const firstCardRect = cards[0].getBoundingClientRect();
    const cardWidth = firstCardRect.width || cards[0].offsetWidth || 1;
    const gap = parseFloat(getComputedStyle(container).gap) || 0;
    const totalWidth = (cardWidth * cards.length) + (gap * Math.max(cards.length - 1, 0));
    if (totalWidth <= availableWidth)
        return;
    const requiredOverlap = (totalWidth - availableWidth) / Math.max(cards.length - 1, 1);
    const maxOverlap = cardWidth * 0.58;
    const overlap = Math.min(requiredOverlap, maxOverlap);
    if (overlap <= 0)
        return;
    container.classList.add("handStacked");
    container.style.setProperty("--hand-overlap", `${overlap}px`);
}
const handStackLayoutFrames = { youHand: 0, aiHand: 0 };
function queueHandStackLayout(containerId) {
    if (handStackLayoutFrames[containerId])
        return;
    handStackLayoutFrames[containerId] = requestAnimationFrame(() => applyHandStackLayout(containerId));
}
window.addEventListener("resize", () => {
    queueHandStackLayout("youHand");
    queueHandStackLayout("aiHand");
});
window.addEventListener("orientationchange", () => {
    queueHandStackLayout("youHand");
    queueHandStackLayout("aiHand");
});
function renderLane(zoneId, cards, activeIndex, onClick, hpValues) {
    const zone = document.getElementById(zoneId);
    if (!zone)
        return;
    const previousCards = previousLaneCards[zoneId] || [];
    const slots = Array.from(zone.children);
    for (let index = 0; index < slots.length; index += 1) {
        const slotEl = slots[index];
        clearAttackTargetHover(slotEl);
        const incomingCardId = String(cards[index] || "");
        if (zoneId === "you-field")
            slotEl.id = `you-ally-${index}`;
        else if (zoneId === "ai-field")
            slotEl.id = `ai-ally-${index}`;
        else if (zoneId === "you-support")
            slotEl.id = `you-support-${index}`;
        else if (zoneId === "ai-support")
            slotEl.id = `ai-support-${index}`;
        const existingCard = slotEl.querySelector(":scope > .card");
        if (existingCard && previousCards[index] && previousCards[index] !== incomingCardId) {
            if (!consumeLanePileFlight(zoneId, previousCards[index]))
                spawnDeathGhost(slotEl, existingCard);
        }
        for (const oldCard of Array.from(slotEl.querySelectorAll(":scope > .card")))
            oldCard.remove();
        slotEl.classList.remove("clickable", "selected", "dropTarget", "combat-target");
        slotEl.onclick = null;
        slotEl.ondragenter = null;
        slotEl.ondragover = null;
        slotEl.ondragleave = null;
        slotEl.ondrop = null;
        if (zoneId === "you-field" || zoneId === "you-support") {
            const dropLane = zoneId === "you-field" ? "field" : "support";
            slotEl.ondragenter = (event) => {
                event.preventDefault();
                if (!isMyTurn || currentPhase !== "PREP")
                    return;
                const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
                if (!draggedCardId || laneForCard(draggedCardId) !== dropLane)
                    return;
                slotEl.classList.add("dropTarget");
            };
            slotEl.ondragover = (event) => {
                event.preventDefault();
                if (!isMyTurn || currentPhase !== "PREP")
                    return;
                const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
                if (!draggedCardId || laneForCard(draggedCardId) !== dropLane)
                    return;
                slotEl.classList.add("dropTarget");
            };
            slotEl.ondragleave = () => slotEl.classList.remove("dropTarget");
            slotEl.ondrop = (event) => {
                event.preventDefault();
                slotEl.classList.remove("dropTarget");
                if (!isMyTurn || currentPhase !== "PREP")
                    return;
                if (cards[index])
                    return;
                const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
                if (!draggedCardId)
                    return;
                if (laneForCard(draggedCardId) !== dropLane)
                    return;
                selectedHandCardId = draggedCardId;
                if (view.selectedCardEl)
                    view.selectedCardEl.textContent = selectedHandCardId;
                tryPlayCard(draggedCardId, index);
            };
        }
        const cardId = cards[index];
        if (!cardId) {
            bindMobileCardInspect(slotEl, null);
            slotEl.onmousemove = null;
            slotEl.onmouseleave = null;
            continue;
        }
        const side = zoneId.startsWith("you") ? "you" : "ai";
        const lane = zoneId.endsWith("field") ? "field" : "support";
        bindMobileCardInspect(slotEl, { cardId, side, lane, index });
        const cardEl = buildHandCard(cardId, false, undefined, { cardId, side, lane, index });
        cardEl.className = "card slotCard";
        if (zoneId === "you-field" && tappedBySide.you.has(index))
            cardEl.classList.add("tapped");
        if (zoneId === "ai-field" && tappedBySide.ai.has(index))
            cardEl.classList.add("tapped");
        if (zoneId === "you-field" && canSelectCombatAttacker(index))
            cardEl.classList.add("can-attack");
        if (zoneId === "ai-field" && canSelectCombatTarget({ type: "ally", side: "ai", index }))
            cardEl.classList.add("can-be-targeted");
        const renderSide = side;
        if ((zoneId === "you-field" || zoneId === "ai-field") && untapPulseBySide[renderSide] && justUntappedBySide[renderSide].has(index)) {
            cardEl.classList.add("just-untapped");
        }
        cardEl.style.width = "100%";
        cardEl.style.height = "100%";
        cardEl.style.margin = "0";
        if (zoneId === "you-field" || zoneId === "ai-field") {
            const side = zoneId === "you-field" ? "you" : "ai";
            const maxHp = getDisplayedFieldMaxHp(side, index, cardId);
            const currentHp = Math.max(0, Number(hpValues?.[index] ?? maxHp));
            const attack = getFieldAttackValue(side, index, cardId);
            const resistance = getFieldResistanceValue(side, index, cardId);
            appendBloodTag(cardEl, getFieldBloodMarksForSide(side, index));
            appendVitalTag(cardEl, getFieldVitalMarksForSide(side, index));
            appendAllyStatsBar(cardEl, { hp: currentHp, maxHp, attack, resistance });
            appendEquipAttachTag(cardEl, zoneId === "you-field" ? "you" : "ai", index);
        }
        if (zoneId === "you-support" || zoneId === "ai-support") {
            if (String(resolveCard(cardId)?.effect || "") !== "draw_bonus") {
                appendSupportCounterTag(cardEl, getSupportCounterForSide(renderSide, index));
            }
        }
        slotEl.onmousemove = () => setHoveredInspector({ cardId, side, lane, index });
        slotEl.onmouseleave = () => setHoveredInspector(null);
        slotEl.appendChild(cardEl);
        if (!previousCards[index] && cardId)
            animateEl(cardEl, "anim-play");
        if (activeIndex === index)
            slotEl.classList.add("selected");
        if (zoneId === "ai-field" && canSelectCombatTarget({ type: "ally", side: "ai", index }))
            slotEl.classList.add("combat-target");
        if (onClick) {
            const allowClick = zoneId === "ai-field"
                ? (selectedAttackerPos === null || currentPhase !== "COMBAT" || !isMyTurn || canSelectCombatTarget({ type: "ally", side: "ai", index }))
                : (zoneId !== "you-field" || currentPhase !== "COMBAT" || canSelectCombatAttacker(index));
            if (allowClick) {
                slotEl.classList.add("clickable");
                slotEl.onclick = () => {
                    const target = { cardId, side, lane, index };
                    if (isMobileGameplay() && currentPhase !== "COMBAT") {
                        setInspector(target);
                        return;
                    }
                    onClick(index);
                };
                if (zoneId === "ai-field" && isMyTurn && currentPhase === "COMBAT" && selectedAttackerPos !== null && canSelectCombatTarget({ type: "ally", side: "ai", index })) {
                    slotEl.__attackHoverCleanup = bindAttackTargetHover(slotEl);
                }
            }
        }
        else {
            slotEl.classList.add("clickable");
            slotEl.onclick = () => {
                const target = { cardId, side, lane, index };
                setInspector(target);
            };
        }
    }
    previousLaneCards[zoneId] = cards.slice();
}
function renderLeaderSlot(slotId, leaderId, currentHpValue) {
    const slotEl = document.getElementById(slotId);
    if (!slotEl)
        return;
    for (const oldCard of Array.from(slotEl.querySelectorAll(":scope > .card")))
        oldCard.remove();
    const leader = String(leaderId || "").trim();
    if (!leader)
        return;
    const side = slotId === "you-leader" ? "you" : "ai";
    const cardEl = buildHandCard(leader, false, undefined, { cardId: leader, side, lane: "leader" });
    cardEl.className = "card slotCard";
    const tapped = side === "you" ? currentMyLeaderTapped : currentEnemyLeaderTapped;
    const leaderPowerReady = side === "you" && hasManualLeaderPower(leader) && canUseLeaderPower();
    if (tapped)
        cardEl.classList.add("tapped");
    if (untapPulseBySide[side] && justUntappedLeaderBySide[side])
        cardEl.classList.add("just-untapped");
    setChosenReady(cardEl, leaderPowerReady);
    cardEl.style.width = "100%";
    cardEl.style.height = "100%";
    cardEl.style.margin = "0";
    const baseMaxHp = Number(resolveCard(leader)?.hp || 20);
    const currentHp = Math.max(0, Number(currentHpValue ?? baseMaxHp));
    const maxHp = getLeaderMaxHpValue(side, leader);
    const resistanceFromEquip = getLeaderEquipResistanceBonus(side);
    appendVitalTag(cardEl, side === "you" ? currentMyLeaderVitalMarks : currentEnemyLeaderVitalMarks);
    appendSpiderTag(cardEl, side === "you" ? currentMyLeaderSpiderMarks : currentEnemyLeaderSpiderMarks);
    appendChosenStatsBar(cardEl, { hp: currentHp, maxHp, resistance: resistanceFromEquip });
    appendEquipAttachTag(cardEl, side, null);
    slotEl.onmousemove = () => setHoveredInspector({ cardId: leader, side, lane: "leader" });
    slotEl.onmouseleave = () => setHoveredInspector(null);
    slotEl.onclick = () => {
        const target = { cardId: leader, side, lane: "leader" };
        setInspector(target);
    };
    slotEl.appendChild(cardEl);
}
function getFieldVitalMarksForSide(side, index) {
    const source = side === "you" ? currentMyFieldVitalMarks : currentEnemyFieldVitalMarks;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
function getFieldBloodMarksForSide(side, index) {
    const source = side === "you" ? currentMyFieldBloodMarks : currentEnemyFieldBloodMarks;
    const value = Number(source[index] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
function getDisplayedFieldMaxHp(side, index, cardId) {
    const baseMaxHp = Number(resolveCard(cardId)?.hp || 1);
    return Math.max(1, baseMaxHp
        + getFieldVitalMarksForSide(side, index)
        + getFieldBlessingForSide(side, index)
        + getAttachedSupportNumericBonusForSide(side, index, "hpBonus")
        + getAuraHpBonusForSide(side, cardId));
}
function appendMarkerTag(cardEl, text, background, color) {
    const offsetIndex = cardEl.querySelectorAll(":scope > .markerTag").length;
    const tag = document.createElement("div");
    tag.className = "markerTag";
    tag.textContent = text;
    tag.style.top = `${4 + (offsetIndex * 20)}px`;
    tag.style.background = background;
    tag.style.color = color;
    cardEl.appendChild(tag);
}
function appendVitalTag(cardEl, marks) {
    const total = Math.max(0, Number(marks || 0));
    if (!total)
        return;
    appendMarkerTag(cardEl, `🍀 ${total}`, "rgba(22, 101, 52, 0.92)", "#f0fdf4");
}
function appendSpiderTag(cardEl, marks) {
    const total = Math.max(0, Number(marks || 0));
    if (!total)
        return;
    appendMarkerTag(cardEl, `🕷 ${total}`, "rgba(17, 24, 39, 0.94)", "#f9fafb");
}
function appendBloodTag(cardEl, marks) {
    const total = Math.max(0, Number(marks || 0));
    if (!total)
        return;
    appendMarkerTag(cardEl, `🩸 ${total}`, "rgba(153, 27, 27, 0.94)", "#fef2f2");
}
function getFragImage(playerState) {
    const leader = resolveCard(String(playerState?.leaderId || ""));
    const source = String(playerState?.filiacao || leader?.filiacao || leader?.classe || "");
    const normalized = normalizeKind(source);
    if (normalized.includes("arcan"))
        return asAssetPath("fragments/layout-fragmento_arcano.png");
    if (normalized.includes("marcial"))
        return asAssetPath("fragments/layout-fragmento_marcial.png");
    if (normalized.includes("santa") || normalized.includes("relig"))
        return asAssetPath("fragments/layout-fragmento_religioso.png");
    if (normalized.includes("sombr"))
        return asAssetPath("fragments/layout-fragmento_sombras.png");
    return asAssetPath("fragments/FRAGMENTOS.png");
}
function renderFragments(containerId, total, maxTotal, fragImage, spentFirst = false) {
    const container = document.getElementById(containerId);
    if (!container)
        return;
    container.innerHTML = "";
    const cap = Math.max(0, Math.min(10, Number(maxTotal || 10)));
    const amount = Math.max(0, Math.min(cap, Number(total || 0)));
    const activeStartIndex = spentFirst ? 1 : 0;
    const fragmentBackImage = asAssetPath(CARD_BACK_ASSET);
    for (let index = 0; index < cap; index += 1) {
        const token = document.createElement("div");
        token.className = "fragToken ready";
        token.style.setProperty("--frag-img", `url('${fragImage}')`);
        token.style.setProperty("--frag-back-img", `url('${fragmentBackImage}')`);
        if (spentFirst && index === 0) {
            token.classList.add("spent");
            token.title = "Fragmento indisponível por Caminhos Perigosos";
        }
        if (index >= activeStartIndex && index < activeStartIndex + amount)
            token.classList.add("on");
        container.appendChild(token);
    }
}
function formatPhaseLabel(phase) {
    const value = String(phase || "—");
    if (value === "MULLIGAN")
        return "Mulligan";
    if (value === "INITIAL")
        return "Inicial";
    return value;
}
function asStringArray(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value.map((v) => String(v));
    if (typeof value[Symbol.iterator] === "function")
        return Array.from(value).map((v) => String(v));
    if (typeof value === "object")
        return Object.keys(value).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).map((k) => String(value[k]));
    return [];
}
function asNumberArray(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value.map((v) => Number(v || 0));
    if (typeof value[Symbol.iterator] === "function")
        return Array.from(value).map((v) => Number(v || 0));
    if (typeof value === "object") {
        return Object.keys(value)
            .filter((k) => /^\d+$/.test(k))
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => Number(value[k] || 0));
    }
    return [];
}
function asBoolArray(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value.map((v) => !!v);
    if (typeof value[Symbol.iterator] === "function")
        return Array.from(value).map((v) => !!v);
    if (typeof value === "object") {
        return Object.keys(value)
            .filter((k) => /^\d+$/.test(k))
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => !!value[k]);
    }
    return [];
}
function inferSlotFromState(state) {
    const resolvedSessionId = selfSessionId || (typeof room?.sessionId === "string" ? room.sessionId : null);
    if (!resolvedSessionId)
        return null;
    const players = state?.players;
    if (!players)
        return null;
    if (typeof players.get === "function") {
        const p = players.get(resolvedSessionId);
        if (p?.slot === "p1" || p?.slot === "p2")
            return p.slot;
    }
    const byKey = players[resolvedSessionId];
    if (byKey?.slot === "p1" || byKey?.slot === "p2")
        return byKey.slot;
    for (const key of Object.keys(players)) {
        const p = players[key];
        if (p?.sessionId === resolvedSessionId && (p?.slot === "p1" || p?.slot === "p2"))
            return p.slot;
    }
    return null;
}
function getPublicPlayerName(state, targetSlot) {
    const fallback = targetSlot === "p1" ? "Jogador 1" : "Jogador 2";
    const players = state?.players;
    if (!players || typeof players !== "object")
        return fallback;
    if (typeof players.forEach === "function") {
        let resolvedName = "";
        players.forEach((player) => {
            if (player?.slot !== targetSlot || resolvedName)
                return;
            resolvedName = String(player?.displayName || "").trim();
        });
        return resolvedName || fallback;
    }
    for (const player of Object.values(players)) {
        if (player?.slot !== targetSlot)
            continue;
        const displayName = String(player?.displayName || "").trim();
        return displayName || fallback;
    }
    return fallback;
}
function getPublicPlayerAvatar(state, targetSlot) {
    const players = state?.players;
    if (!players || typeof players !== "object")
        return "";
    if (typeof players.forEach === "function") {
        let avatarId = "";
        players.forEach((player) => {
            if (player?.slot !== targetSlot || avatarId)
                return;
            avatarId = String(player?.avatarId || "").trim();
        });
        return avatarId;
    }
    for (const player of Object.values(players)) {
        if (player?.slot === targetSlot)
            return String(player?.avatarId || "").trim();
    }
    return "";
}
function setArenaAvatar(avatarEl, avatarId, playerName) {
    if (!avatarEl)
        return;
    const avatarPath = AVATAR_PATHS[avatarId];
    avatarEl.hidden = !avatarPath;
    if (!avatarPath) {
        avatarEl.removeAttribute("src");
        avatarEl.alt = "";
        return;
    }
    if (avatarEl.getAttribute("src") !== avatarPath)
        avatarEl.src = avatarPath;
    avatarEl.alt = `Avatar de ${playerName}`;
}
function syncArenaPlayerNames(state) {
    const mySlot = slot === "p2" ? "p2" : "p1";
    const enemySlot = mySlot === "p1" ? "p2" : "p1";
    const myNameEl = document.getElementById("youName");
    const enemyNameEl = document.getElementById("aiName");
    const myName = getPublicPlayerName(state, mySlot);
    const enemyName = getPublicPlayerName(state, enemySlot);
    publicPlayerNames[mySlot] = myName;
    publicPlayerNames[enemySlot] = enemyName;
    if (myNameEl)
        myNameEl.textContent = myName;
    if (enemyNameEl)
        enemyNameEl.textContent = enemyName;
    setArenaAvatar(document.getElementById("youAvatar"), getPublicPlayerAvatar(state, mySlot), myName);
    setArenaAvatar(document.getElementById("aiAvatar"), getPublicPlayerAvatar(state, enemySlot), enemyName);
}
function syncHandTitles(state) {
    const enemyHandTitleEl = document.querySelector("#enemyHandDock .handDockTitle");
    const myHandTitleEl = document.querySelector("#youHandDock .handDockTitle");
    const enemyHandEl = document.getElementById("aiHand");
    const myHandEl = document.getElementById("youHand");
    if (!enemyHandTitleEl || !myHandTitleEl || !enemyHandEl || !myHandEl)
        return;
    if (!isSpectator) {
        enemyHandTitleEl.textContent = "Mão do Oponente";
        myHandTitleEl.textContent = "Sua Mão";
        enemyHandEl.setAttribute("aria-label", "Mão do oponente");
        myHandEl.setAttribute("aria-label", "Sua mão");
        return;
    }
    const mySlot = slot === "p2" ? "p2" : "p1";
    const enemySlot = mySlot === "p1" ? "p2" : "p1";
    const myName = getPublicPlayerName(state, mySlot);
    const enemyName = getPublicPlayerName(state, enemySlot);
    myHandTitleEl.textContent = `Mão de ${myName}`;
    enemyHandTitleEl.textContent = `Mão de ${enemyName}`;
    myHandEl.setAttribute("aria-label", `Mão de ${myName}`);
    enemyHandEl.setAttribute("aria-label", `Mão de ${enemyName}`);
}
function updateArenaTurnPriority(myTurn) {
    const myArena = document.getElementById("youArena");
    const enemyArena = document.getElementById("opArena");
    if (!myArena || !enemyArena)
        return;
    const applyState = (el, active, muted) => {
        el.classList.toggle("arenaTurnActive", active);
        el.classList.toggle("arenaTurnMuted", muted);
        el.classList.toggle("arenaTurnNeutral", !active && !muted);
    };
    if (isSpectator) {
        applyState(myArena, false, false);
        applyState(enemyArena, false, false);
        return;
    }
    applyState(myArena, myTurn, !myTurn);
    applyState(enemyArena, !myTurn, myTurn);
}
function goLobby() {
    clearMatchReconnectTimer();
    const endpoint = view.endpointEl?.value?.trim() || resolveServerEndpoint(window.location.search);
    const search = new URLSearchParams(window.location.search);
    const lobbyPath = search.get("solo") === "1" ? "./solo-lobby.html" : "./lobby.html";
    const targetUrl = `${lobbyPath}?endpoint=${encodeURIComponent(endpoint)}`;
    const activeRoom = room;
    room = null;
    if (activeRoom && typeof activeRoom.leave === "function") {
        void Promise.resolve(activeRoom.leave()).catch(() => undefined).finally(() => {
            window.location.href = targetUrl;
        });
        setTimeout(() => {
            if (window.location.href !== targetUrl)
                window.location.href = targetUrl;
        }, 500);
        return;
    }
    window.location.href = targetUrl;
}
function clearSpectatorReconnectTimer() {
    if (spectatorReconnectTimer) {
        window.clearTimeout(spectatorReconnectTimer);
        spectatorReconnectTimer = null;
    }
}
function clearMatchReconnectTimer() {
    if (matchReconnectTimer) {
        window.clearTimeout(matchReconnectTimer);
        matchReconnectTimer = null;
    }
}
function showReconnectOverlay(state, title, text, status) {
    if (reconnectOverlayHideTimer) {
        window.clearTimeout(reconnectOverlayHideTimer);
        reconnectOverlayHideTimer = null;
    }
    const modal = document.getElementById("reconnectModal");
    const titleEl = document.getElementById("reconnectTitle");
    const textEl = document.getElementById("reconnectText");
    const attemptEl = document.getElementById("reconnectAttempt");
    if (!modal)
        return;
    modal.dataset.state = state;
    if (titleEl)
        titleEl.textContent = title;
    if (textEl)
        textEl.textContent = text;
    if (attemptEl)
        attemptEl.textContent = status;
    modal.style.display = "flex";
}
function showReconnectSuccess(message) {
    showReconnectOverlay("success", "Conexão restabelecida", message, "Retomando a partida...");
    reconnectOverlayHideTimer = window.setTimeout(() => {
        const modal = document.getElementById("reconnectModal");
        if (modal)
            modal.style.display = "none";
        reconnectOverlayHideTimer = null;
    }, 850);
}
function showOpponentReconnecting(msg) {
    if (isMatchFinished)
        return;
    const graceSeconds = Number(msg?.graceSeconds) || 60;
    showReconnectOverlay("waiting", "Oponente reconectando", "A conexão do seu oponente foi interrompida. A partida está reservada enquanto ele tenta voltar.", `Aguardando retorno por até ${graceSeconds} segundos`);
    logText("A conexão do oponente caiu. Aguardando reconexão...");
}
function showOpponentReconnected() {
    if (isMatchFinished)
        return;
    showReconnectSuccess("Seu oponente voltou à partida.");
    logText("Oponente reconectado à partida.");
}
function captureMatchReconnectionToken(activeRoom) {
    matchReconnectionToken = String(activeRoom?.reconnectionToken || matchReconnectionToken || "");
}
async function reconnectActiveMatch() {
    if (isSpectator || !matchReconnectionToken)
        return false;
    try {
        reportClientDiagnostic("reconnect_attempt", `attempt=${matchReconnectAttempts}`);
        const endpoint = view.endpointEl?.value.trim() || resolveServerEndpoint(window.location.search);
        client = client || await connectClient(endpoint);
        const nextRoom = await client.reconnect(matchReconnectionToken);
        room = nextRoom;
        roomId = nextRoom.id;
        selfSessionId = typeof nextRoom?.sessionId === "string" ? nextRoom.sessionId : selfSessionId;
        captureMatchReconnectionToken(nextRoom);
        bindActiveMatchRoom();
        logText("Reconectado à partida.");
        reportClientDiagnostic("reconnect_success", `attempt=${matchReconnectAttempts}`);
        showReconnectSuccess("A partida foi recuperada com sucesso.");
        matchReconnectAttempts = 0;
        nextRoom.send("request_connection_status");
        return true;
    }
    catch (error) {
        reportClientDiagnostic("reconnect_failure", String(error));
        log("ERROR", { text: `Falha ao reconectar partida: ${String(error)}` });
        return false;
    }
}
function scheduleMatchReconnect(code) {
    if (matchReconnectAttempts === 0)
        reportClientDiagnostic("websocket_leave", "room.onLeave", code);
    if (isMatchFinished) {
        setTimeout(() => goLobby(), 900);
        return;
    }
    if (isSpectator || !matchReconnectionToken) {
        log("DISCONNECTED", { code, text: "Conexão encerrada. Voltando ao lobby..." });
        showReconnectOverlay("failed", "Conexão encerrada", "Não foi possível manter esta partida ativa.", "Voltando ao lobby...");
        setTimeout(() => goLobby(), 1600);
        return;
    }
    if (matchReconnectAttempts >= MATCH_RECONNECT_MAX_ATTEMPTS) {
        log("DISCONNECTED", { code, text: "Não foi possível reconectar. Voltando ao lobby..." });
        showReconnectOverlay("failed", "Não foi possível reconectar", "A partida não respondeu dentro do tempo limite.", "Voltando ao lobby...");
        setTimeout(() => goLobby(), 1600);
        return;
    }
    clearMatchReconnectTimer();
    const nextAttempt = matchReconnectAttempts + 1;
    matchReconnectAttempts = nextAttempt;
    const retryDelayMs = Math.min(1000 + ((nextAttempt - 1) * 500), 5000);
    logText(`Reconectando partida (${nextAttempt}/${MATCH_RECONNECT_MAX_ATTEMPTS})...`);
    const reconnectText = navigator.onLine
        ? "A conexão ficou instável. Aguarde enquanto recuperamos a partida."
        : "Seu dispositivo está sem internet. A partida voltará assim que a conexão retornar.";
    showReconnectOverlay("reconnecting", "Reconectando à partida", reconnectText, `Tentativa ${nextAttempt} de ${MATCH_RECONNECT_MAX_ATTEMPTS}`);
    matchReconnectTimer = window.setTimeout(() => {
        void reconnectActiveMatch().then((ok) => {
            if (!ok)
                scheduleMatchReconnect(code);
        });
    }, retryDelayMs);
}
async function reconnectSpectator() {
    if (!isSpectator || !spectatorMatchRoomId || !view.endpointEl)
        return false;
    try {
        const endpoint = view.endpointEl.value.trim();
        const targetJoinRoomId = await resolveSpectatorRoomId(endpoint, spectatorMatchRoomId);
        room = await joinMatchById(client, targetJoinRoomId, {});
        roomId = room.id;
        selfSessionId = typeof room?.sessionId === "string" ? room.sessionId : selfSessionId;
        slot = "p1";
        bindActiveMatchRoom();
        logText("Reconectado ao modo espectador.");
        showReconnectSuccess("A transmissão da partida foi recuperada.");
        spectatorReconnectAttempts = 0;
        return true;
    }
    catch (error) {
        log("ERROR", { text: `Falha ao reconectar espectador: ${String(error)}` });
        return false;
    }
}
function scheduleSpectatorReconnect(code) {
    if (isMatchFinished)
        return;
    if (!isSpectator || !spectatorMatchRoomId) {
        showReconnectOverlay("failed", "Conexão encerrada", "Não foi possível recuperar a transmissão.", "Voltando ao lobby...");
        setTimeout(() => goLobby(), 1600);
        return;
    }
    if (spectatorReconnectAttempts >= 3) {
        log("DISCONNECTED", { code, text: "Conexão do espectador encerrada. Voltando ao lobby..." });
        showReconnectOverlay("failed", "Não foi possível reconectar", "A transmissão não respondeu dentro do tempo limite.", "Voltando ao lobby...");
        setTimeout(() => goLobby(), 1600);
        return;
    }
    clearSpectatorReconnectTimer();
    const nextAttempt = spectatorReconnectAttempts + 1;
    spectatorReconnectAttempts = nextAttempt;
    logText(`Reconectando espectador (${nextAttempt}/3)...`);
    showReconnectOverlay("reconnecting", "Reconectando à partida", navigator.onLine ? "A conexão com a transmissão foi interrompida." : "Seu dispositivo está sem internet.", `Tentativa ${nextAttempt} de 3`);
    spectatorReconnectTimer = window.setTimeout(() => {
        void reconnectSpectator().then((ok) => {
            if (!ok)
                scheduleSpectatorReconnect(code);
        });
    }, 700);
}
function bindActiveMatchRoom() {
    if (!room)
        return;
    bindMatchHandlers(room, {
        onAssignSlot: (msg) => {
            isSpectator = msg?.spectator === true || isSpectator;
            slot = isSpectator ? "p1" : (msg?.slot || null);
            selfSessionId = typeof msg?.sessionId === "string" ? msg.sessionId : null;
            log("ASSIGN_SLOT", msg);
        },
        onCardPlayed: (msg) => {
            diaryCardPlayed(msg);
            const side = sideFromServerSlot((msg?.slot || ""));
            if (!side)
                return;
            if (String(msg?.lane || "") !== "field")
                return;
            const targetPos = Number(msg?.targetPos);
            if (!Number.isInteger(targetPos) || targetPos < 0)
                return;
            summonedBySide[side].add(targetPos);
        },
        onEffectChoice: (msg) => {
            if (!isSpectator)
                showEffectChoiceModal(msg);
        },
        onRevealTopCard: (msg) => {
            if (!isSpectator)
                showRevealTopCardModal(msg);
        },
        onOpponentReconnecting: showOpponentReconnecting,
        onOpponentReconnected: showOpponentReconnected,
        onError: (msg) => log("ERROR", msg),
        onLeave: (code) => {
            hideCardChoiceModal(false);
            hideChoiceWaitingModal();
            if (isSpectator) {
                scheduleSpectatorReconnect(code);
                return;
            }
            scheduleMatchReconnect(code);
        },
        onLog: (name, msg) => {
            if (name === "ATTACK_RESOLVED")
                diaryAttackResolved(msg);
            else if (name === "TURN_START")
                diaryTurnStart(msg);
            else if (name === "EFFECT")
                diaryEffect(msg);
            else if (name === "CHOICE_WAITING") {
                if (!isSpectator) {
                    showChoiceWaitingModal(msg);
                    logText(`⏳ Seu oponente está escolhendo: ${String(msg?.title || "uma opção")}.`);
                }
            }
            else if (name === "CHOICE_WAITING_END") {
                if (!isSpectator)
                    hideChoiceWaitingModal();
            }
            else if (name === "MATCH_ENDED") {
                const winner = ownerLabel(String(msg?.winner || ""));
                logText(`🏁 Partida encerrada. Vencedor: ${winner}.`);
                isMatchFinished = true;
                hideCardChoiceModal(false);
                hideChoiceWaitingModal();
                const seq = Number(msg?.seq ?? -1);
                if (seq !== lastMatchEndSeq) {
                    lastMatchEndSeq = seq;
                    const result = describeMatchEnded(msg);
                    showVictory(result);
                }
            }
            if (name === "EFFECT") {
                const side = sideFromServerSlot((msg?.slot || ""));
                const effect = String(msg?.effect || "").trim();
                if (side && ["valbrak_citizen_boost", "ademais_spider_burst", "leafae_vital_guard"].includes(effect)) {
                    animateChosenPowerActivation(side);
                }
            }
            if (name === "TURN_START") {
                const side = sideFromServerSlot((msg?.turnSlot || ""));
                if (side) {
                    justUntappedBySide[side] = new Set(tappedBySide[side]);
                    justUntappedLeaderBySide[side] = tappedLeaderBySide[side];
                    tappedBySide[side].clear();
                    tappedLeaderBySide[side] = false;
                    untapPulseBySide[side] = true;
                    setTimeout(() => {
                        untapPulseBySide[side] = false;
                        justUntappedBySide[side].clear();
                        justUntappedLeaderBySide[side] = false;
                    }, 260);
                    summonedBySide[side].clear();
                }
            }
            if (name === "ATTACK_RESOLVED") {
                const side = sideFromServerSlot((msg?.attackerSlot || ""));
                const attackerPos = Number(msg?.attackerPos);
                if (!side)
                    return;
                if (Number.isInteger(attackerPos) && attackerPos >= 0)
                    tappedBySide[side].add(attackerPos);
                if (msg?.attackerLeader === true || msg?.attacker === "leader" || attackerPos === -1)
                    tappedLeaderBySide[side] = true;
            }
        },
        onStateSync: (state) => {
            if (String(state?.phase || "") === "FINISHED")
                isMatchFinished = true;
            if (view.turnPhaseEl)
                view.turnPhaseEl.textContent = formatPhaseLabel(state?.game?.phase);
            if (view.roomIdViewEl)
                view.roomIdViewEl.textContent = roomId ?? "—";
            if (view.slotEl)
                view.slotEl.textContent = isSpectator ? "Espectador" : (slot ?? "—");
            if (view.turnEl)
                view.turnEl.textContent = String(state?.game?.turn ?? "—");
            if (view.turnSlotEl)
                view.turnSlotEl.textContent = String(state?.game?.turnSlot ?? "—");
            if (view.p1HpEl)
                view.p1HpEl.textContent = String(state?.game?.p1?.hp ?? "—");
            if (view.p2HpEl)
                view.p2HpEl.textContent = String(state?.game?.p2?.hp ?? "—");
            if (view.p1FragmentsEl)
                view.p1FragmentsEl.textContent = String(state?.game?.p1?.fragments ?? "—");
            if (view.p2FragmentsEl)
                view.p2FragmentsEl.textContent = String(state?.game?.p2?.fragments ?? "—");
            if (view.p1HandCountEl)
                view.p1HandCountEl.textContent = String(state?.game?.p1?.hand?.length ?? "—");
            if (view.p2HandCountEl)
                view.p2HandCountEl.textContent = String(state?.game?.p2?.hand?.length ?? "—");
            if (isSpectator && !slot)
                slot = "p1";
            if (!slot && !isSpectator)
                slot = inferSlotFromState(state);
            if (!slot)
                return;
            syncArenaPlayerNames(state);
            syncHandTitles(state);
            const previousMyField = currentMyField.slice();
            const previousMyFieldHp = currentMyFieldHp.slice();
            const previousMySupport = currentMySupport.slice();
            const previousMyEnv = currentMyEnv;
            const previousMyGrave = currentMyGrave.slice();
            const previousMyBanished = currentMyBanished.slice();
            const previousMyHand = previousHandCards.youHand.slice();
            let myHandTransferSnapshots = new Map();
            const previousEnemyHand = previousHandCards.aiHand.slice();
            let enemyHandTransferSnapshots = new Map();
            const previousEnemyField = currentEnemyField.slice();
            const previousEnemyFieldHp = currentEnemyFieldHp.slice();
            const previousEnemySupport = currentEnemySupport.slice();
            const previousEnemyGrave = currentEnemyGrave.slice();
            const previousEnemyBanished = currentEnemyBanished.slice();
            let boardTransferSnapshots = new Map();
            const previousMyLeader = currentMyLeader;
            const previousMyLeaderHp = currentMyLeaderHp;
            const previousEnemyLeader = currentEnemyLeader;
            const previousEnemyLeaderHp = currentEnemyLeaderHp;
            const my = slot === "p1" ? state?.game?.p1 : state?.game?.p2;
            const enemy = slot === "p1" ? state?.game?.p2 : state?.game?.p1;
            currentMyFragments = Number(my?.fragments ?? 0);
            currentEnemyFragments = Number(enemy?.fragments ?? 0);
            const turnMarker = `${String(state?.game?.turn || "")}::${String(state?.game?.turnSlot || "")}`;
            if (turnMarker !== lastTurnMarker) {
                lastTurnMarker = turnMarker;
                const startedSide = sideFromServerSlot((state?.game?.turnSlot || ""));
                if (startedSide === "you")
                    myTurnCount += 1;
                if (startedSide === "ai")
                    enemyTurnCount += 1;
            }
            const hand = asStringArray(my?.hand);
            currentMyHand = hand.slice();
            currentMyDeck = asStringArray(my?.deck);
            currentMyGrave = asStringArray(my?.grave);
            currentMyBanished = asStringArray(my?.banished || my?.ban);
            const myField = asStringArray(my?.field);
            const myFieldHp = asNumberArray(my?.fieldHp);
            const myFieldAtkTemp = asNumberArray(my?.fieldAtkTemp);
            const myFieldAtkPerm = asNumberArray(my?.fieldAtkPerm);
            const myFieldAcPerm = asNumberArray(my?.fieldAcPerm);
            const myFieldBlessing = asNumberArray(my?.fieldBlessing);
            const myFieldBlood = asNumberArray(my?.fieldBloodMarks);
            const myFieldVital = asNumberArray(my?.fieldVitalMarks);
            const myFieldTapped = asBoolArray(my?.fieldTapped);
            tappedBySide.you.clear();
            for (let i = 0; i < myFieldTapped.length; i += 1)
                if (myFieldTapped[i])
                    tappedBySide.you.add(i);
            currentMyField = myField;
            currentMyFieldHp = myFieldHp;
            currentMyFieldAtkTemp = myFieldAtkTemp;
            currentMyFieldAtkPerm = myFieldAtkPerm;
            currentMyFieldAcPerm = myFieldAcPerm;
            currentMyFieldBlessing = myFieldBlessing;
            currentMyFieldBloodMarks = myFieldBlood;
            currentMyFieldVitalMarks = myFieldVital;
            const mySupport = asStringArray(my?.support);
            currentMySupport = mySupport;
            currentMySupportAttach = asNumberArray(my?.supportAttachTo);
            currentMySupportCounters = asNumberArray(my?.supportCounters);
            currentMyEnv = String(my?.env || "") || null;
            currentMyLeader = String(my?.leaderId || "");
            currentMySleeve = String(my?.sleeveId || "");
            currentMyPlaymat = String(my?.playmatId || "");
            currentMyLeaderHp = Number(my?.hp ?? 0);
            currentMyLeaderTapped = !!my?.leaderTapped;
            currentMyLeaderBlessing = Number(my?.leaderBlessing || 0);
            currentMyLeaderVitalMarks = Number(my?.leaderVitalMarks || 0);
            currentMyLeaderSpiderMarks = Number(my?.leaderSpiderMarks || 0);
            const enemyField = asStringArray(enemy?.field);
            currentEnemyDeck = asStringArray(enemy?.deck);
            currentEnemyGrave = asStringArray(enemy?.grave);
            currentEnemyBanished = asStringArray(enemy?.banished || enemy?.ban);
            const enemyFieldHp = asNumberArray(enemy?.fieldHp);
            const enemyFieldAtkTemp = asNumberArray(enemy?.fieldAtkTemp);
            const enemyFieldAtkPerm = asNumberArray(enemy?.fieldAtkPerm);
            const enemyFieldAcPerm = asNumberArray(enemy?.fieldAcPerm);
            const enemyFieldBlessing = asNumberArray(enemy?.fieldBlessing);
            const enemyFieldBlood = asNumberArray(enemy?.fieldBloodMarks);
            const enemyFieldVital = asNumberArray(enemy?.fieldVitalMarks);
            const enemyFieldTapped = asBoolArray(enemy?.fieldTapped);
            tappedBySide.ai.clear();
            for (let i = 0; i < enemyFieldTapped.length; i += 1)
                if (enemyFieldTapped[i])
                    tappedBySide.ai.add(i);
            currentEnemyField = enemyField;
            currentEnemyFieldHp = enemyFieldHp;
            currentEnemyFieldAtkTemp = enemyFieldAtkTemp;
            currentEnemyFieldAtkPerm = enemyFieldAtkPerm;
            currentEnemyFieldAcPerm = enemyFieldAcPerm;
            currentEnemyFieldBlessing = enemyFieldBlessing;
            currentEnemyFieldBloodMarks = enemyFieldBlood;
            currentEnemyFieldVitalMarks = enemyFieldVital;
            const enemySupport = asStringArray(enemy?.support);
            currentEnemySupport = enemySupport;
            currentEnemySupportAttach = asNumberArray(enemy?.supportAttachTo);
            currentEnemySupportCounters = asNumberArray(enemy?.supportCounters);
            const enemyEnv = String(enemy?.env || "") || null;
            currentEnemyEnv = enemyEnv;
            currentEnemySleeve = String(enemy?.sleeveId || "");
            currentEnemyPlaymat = String(enemy?.playmatId || "");
            currentEnemyLeader = String(enemy?.leaderId || "");
            currentEnemyLeaderHp = Number(enemy?.hp ?? 0);
            currentEnemyLeaderTapped = !!enemy?.leaderTapped;
            currentEnemyLeaderBlessing = Number(enemy?.leaderBlessing || 0);
            currentEnemyLeaderVitalMarks = Number(enemy?.leaderVitalMarks || 0);
            currentEnemyLeaderSpiderMarks = Number(enemy?.leaderSpiderMarks || 0);
            const myHandChanged = !sameStringArray(previousMyHand, hand);
            const enemyHandCount = Number(enemy?.hand?.length ?? 0);
            const enemyHandChanged = previousEnemyHand.length !== enemyHandCount;
            const myBoardChanged = !sameStringArray(previousMyField, myField) || !sameStringArray(previousMySupport, mySupport) || !sameStringArray(previousMyGrave, currentMyGrave) || !sameStringArray(previousMyBanished, currentMyBanished);
            const enemyBoardChanged = !sameStringArray(previousEnemyField, enemyField) || !sameStringArray(previousEnemySupport, enemySupport) || !sameStringArray(previousEnemyGrave, currentEnemyGrave) || !sameStringArray(previousEnemyBanished, currentEnemyBanished);
            if (myHandChanged)
                myHandTransferSnapshots = captureHandTransferSnapshots("youHand");
            if (enemyHandChanged)
                enemyHandTransferSnapshots = captureHandTransferSnapshots("aiHand");
            if (myBoardChanged || enemyBoardChanged)
                boardTransferSnapshots = captureLaneTransferSnapshots(["you-field", "you-support", "ai-field", "ai-support"]);
            const myBoardCardsToPiles = getBoardCardsMovingToPiles(previousMyField, myField, previousMySupport, mySupport, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished);
            const enemyBoardCardsToPiles = getBoardCardsMovingToPiles(previousEnemyField, enemyField, previousEnemySupport, enemySupport, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished);
            queueLanePileFlights("you-field", myBoardCardsToPiles.field);
            queueLanePileFlights("you-support", myBoardCardsToPiles.support);
            queueLanePileFlights("ai-field", enemyBoardCardsToPiles.field);
            queueLanePileFlights("ai-support", enemyBoardCardsToPiles.support);
            const myShadowPenalty = hasShadowPenaltyForPlayer(my, currentMyLeader, currentMyEnv, enemyEnv);
            const enemyShadowPenalty = hasShadowPenaltyForPlayer(enemy, currentEnemyLeader, enemyEnv, currentMyEnv);
            const myTurn = !isSpectator && String(state?.game?.turnSlot || "") === slot;
            isMatchFinished = String(state?.phase || "IN_MATCH") === "FINISHED";
            const phase = String(state?.game?.phase || "");
            if (phase !== currentPhase) {
                resetBoardAttackSelection();
                cancelBoardAttackSelection();
                animatePhaseChange(phase);
            }
            isMyTurn = myTurn;
            currentPhase = phase;
            syncInitiativeUi(state);
            syncMulliganUi(state, hand);
            applyArenaPlaymats();
            updateArenaTurnPriority(myTurn);
            if (!myTurn || phase !== "COMBAT") {
                resetBoardAttackSelection();
                cancelBoardAttackSelection();
            }
            renderFragments("you-fragsDock", my?.fragments, my?.fragmentMax, getFragImage(my), myShadowPenalty);
            renderFragments("ai-fragsDock", enemy?.fragments, enemy?.fragmentMax, getFragImage(enemy), enemyShadowPenalty);
            renderLeaderSlot("you-leader", String(my?.leaderId || ""), Number(my?.hp ?? 0));
            renderLeaderSlot("ai-leader", String(enemy?.leaderId || ""), Number(enemy?.hp ?? 0));
            const myLeaderSlot = document.getElementById("you-leader");
            if (myLeaderSlot)
                myLeaderSlot.onclick = null;
            syncEnemyLeaderCombatTargetState();
            renderEnvSlot("you-env", currentMyEnv, true);
            renderEnvSlot("ai-env", enemyEnv, false);
            renderPileCounts("you", my);
            renderPileCounts("ai", enemy);
            const pileModal = document.getElementById("pileModal");
            if (pileModal && pileModal.style.display === "flex")
                renderPileModal();
            renderSideHand("aiHand", Array.from({ length: enemyHandCount }, (_, index) => `opp-${index}`), false);
            if (selectedHandCardId && !hand.includes(selectedHandCardId))
                selectedHandCardId = null;
            if (selectedAttackerPos !== null && (selectedAttackerPos < 0 || selectedAttackerPos >= myField.length))
                selectedAttackerPos = null;
            if (selectedTargetType === "ally" && (selectedTargetPos === null || selectedTargetPos >= enemyField.length)) {
                selectedTargetType = "leader";
                selectedTargetPos = null;
                if (view.selectedTargetEl)
                    view.selectedTargetEl.textContent = "Líder inimigo";
            }
            renderHand(hand);
            renderMyField(myField, myFieldHp);
            renderMySupport(mySupport);
            renderEnemyField(enemyField, enemyFieldHp);
            renderEnemySupport(enemySupport);
            animateVisibleHandTransfers(myHandTransferSnapshots, "you", previousMyHand, hand, previousMyField, myField, previousMySupport, mySupport, previousMyEnv, currentMyEnv, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished);
            animateHiddenHandTransfers(enemyHandTransferSnapshots, "ai", previousEnemyHand, previousHandCards.aiHand, previousEnemyField, enemyField, previousEnemySupport, enemySupport, null, enemyEnv, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished);
            animateBoardPileTransfers(boardTransferSnapshots, "you-field", "you-support", previousMyField, myField, previousMySupport, mySupport, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished, document.querySelector("#you-grave > .deckVisualCard:last-of-type") || document.getElementById("you-grave"), document.querySelector("#you-banished > .deckVisualCard:last-of-type") || document.getElementById("you-banished"));
            animateBoardPileTransfers(boardTransferSnapshots, "ai-field", "ai-support", previousEnemyField, enemyField, previousEnemySupport, enemySupport, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished, document.querySelector("#ai-grave > .deckVisualCard:last-of-type") || document.getElementById("ai-grave"), document.querySelector("#ai-banished > .deckVisualCard:last-of-type") || document.getElementById("ai-banished"));
            animateFieldDamage("you", previousMyField, myField, previousMyFieldHp, myFieldHp);
            animateFieldDamage("ai", previousEnemyField, enemyField, previousEnemyFieldHp, enemyFieldHp);
            animateLeaderDamage("you-leader", previousMyLeader, currentMyLeader, previousMyLeaderHp, currentMyLeaderHp);
            animateLeaderDamage("ai-leader", previousEnemyLeader, currentEnemyLeader, previousEnemyLeaderHp, currentEnemyLeaderHp);
            setInspector(hoveredInspectorView || selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId, side: "you", lane: "hand" } : null));
            if (view.btnPlay)
                view.btnPlay.disabled = isSpectator || !(myTurn && phase === "PREP" && !!selectedHandCardId);
            if (view.btnLeaderPower) {
                const showLeaderPower = hasManualLeaderPower(currentMyLeader);
                const leaderPowerReady = showLeaderPower && canUseLeaderPower();
                view.btnLeaderPower.style.display = !isSpectator && showLeaderPower ? "" : "none";
                view.btnLeaderPower.disabled = !leaderPowerReady;
                view.btnLeaderPower.classList.toggle("is-ready", leaderPowerReady);
            }
            if (view.btnAttack)
                view.btnAttack.disabled = isSpectator || !(myTurn && phase === "COMBAT" && selectedAttackerPos !== null);
            if (view.btnTargetLeader)
                view.btnTargetLeader.disabled = isSpectator || !(myTurn && phase === "COMBAT");
            if (view.btnNextPhase)
                view.btnNextPhase.disabled = isSpectator || !myTurn || phase === "MULLIGAN";
            if (view.btnEndTurn)
                view.btnEndTurn.disabled = isSpectator || !(myTurn && phase === "END");
        }
    });
}
function animatePhaseChange(phase) {
    animateEl(document.getElementById("phaseBar"), "anim-phase");
    animateEl(view.turnPhaseEl, "anim-phase");
    animateEl(document.querySelector(`.phaseItem[data-phase="${phase}"]`), "anim-phase");
}
function clearAttackTargetHover(el) {
    const cleanup = el?.__attackHoverCleanup;
    if (cleanup)
        cleanup();
    if (el)
        el.__attackHoverCleanup = null;
}
function spawnDeathGhost(slotEl, sourceCard) {
    const ghost = sourceCard.cloneNode(true);
    ghost.style.position = "absolute";
    ghost.style.inset = "0";
    ghost.style.width = "100%";
    ghost.style.height = "100%";
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "4";
    ghost.classList.remove("can-attack", "just-untapped", "tapped");
    slotEl.appendChild(ghost);
    animateEl(ghost, "anim-death");
    ghost.addEventListener("animationend", () => ghost.remove(), { once: true });
    window.setTimeout(() => ghost.remove(), 1600);
}
function animateFieldDamage(side, previousCards, nextCards, previousHp, nextHp) {
    for (let index = 0; index < nextCards.length; index += 1) {
        if (!nextCards[index] || previousCards[index] !== nextCards[index])
            continue;
        const prev = Number(previousHp[index] ?? 0);
        const next = Number(nextHp[index] ?? 0);
        if (!(next < prev))
            continue;
        animateEl(document.querySelector(`#${side}-ally-${index} > .card`), "anim-damage");
    }
}
function animateLeaderDamage(slotId, previousLeaderId, nextLeaderId, previousHp, nextHp) {
    if (!previousLeaderId || previousLeaderId !== nextLeaderId)
        return;
    if (!(Number(nextHp) < Number(previousHp)))
        return;
    animateEl(document.querySelector(`#${slotId} > .card`), "anim-damage");
}
function renderHand(hand) {
    if (isSpectator) {
        renderButtonRow("hand", [], null, "", () => undefined);
        renderSideHand("youHand", Array.from({ length: hand.length }, (_, index) => `spectator-${index}`), false);
        return;
    }
    renderButtonRow("hand", hand.map((c) => `${c} (Custo 1)`), hand.findIndex((c) => c === selectedHandCardId), "outline:2px solid #f8d46d;", (index) => {
        selectedHandCardId = hand[index] || null;
        if (view.selectedCardEl)
            view.selectedCardEl.textContent = selectedHandCardId || "—";
    });
    renderSideHand("youHand", hand, true);
}
function renderMyField(field, hpValues) {
    renderButtonRow("myField", field.map((c, i) => `[${i}] ${c} (ATK 1)`), selectedAttackerPos, "outline:2px solid #2dd4bf;", (index) => {
        if (isMyTurn && currentPhase === "COMBAT") {
            beginBoardAttackFrom(index);
            return;
        }
        setInspector(field[index] ? { cardId: field[index], side: "you", lane: "field", index } : null);
    });
    renderLane("you-field", field, selectedAttackerPos, (index) => {
        if (isMyTurn && currentPhase === "COMBAT") {
            beginBoardAttackFrom(index);
            return;
        }
        setInspector(field[index] ? { cardId: field[index], side: "you", lane: "field", index } : null);
    }, hpValues);
}
function renderEnemyField(field, hpValues) {
    const active = selectedTargetType === "ally" ? selectedTargetPos : null;
    renderButtonRow("enemyField", field.map((c, i) => `[${i}] ${c}`), active ?? null, "outline:2px solid #f87171;", (index) => {
        if (isMyTurn && currentPhase === "COMBAT" && selectedAttackerPos !== null) {
            resolveSelectedBoardAttack({ type: "ally", side: "ai", index });
            return;
        }
        setInspector(field[index] ? { cardId: field[index], side: "ai", lane: "field", index } : null);
    });
    renderLane("ai-field", field, active ?? null, (index) => {
        if (isMyTurn && currentPhase === "COMBAT" && selectedAttackerPos !== null) {
            resolveSelectedBoardAttack({ type: "ally", side: "ai", index });
            return;
        }
        setInspector(field[index] ? { cardId: field[index], side: "ai", lane: "field", index } : null);
    }, hpValues);
}
function renderMySupport(support) {
    renderLane("you-support", support, null);
}
function renderEnemySupport(support) {
    renderLane("ai-support", support, null);
}
async function joinMatch() {
    if (isJoining || !view.endpointEl || !view.roomIdEl)
        return;
    const targetRoomId = view.roomIdEl.value.trim();
    const joinToken = new URLSearchParams(window.location.search).get("joinToken")?.trim() || "";
    const wantsSpectator = new URLSearchParams(window.location.search).get("spectator") === "1";
    if (!targetRoomId)
        return log("ERROR", { text: "Informe roomId da partida." });
    if (!wantsSpectator && !joinToken)
        return log("ERROR", { text: "Token da partida ausente. Entre novamente pelo lobby." });
    isJoining = true;
    try {
        const endpoint = view.endpointEl.value.trim();
        client = await connectClient(endpoint);
        isSpectator = wantsSpectator;
        spectatorMatchRoomId = wantsSpectator ? targetRoomId : null;
        clearSpectatorReconnectTimer();
        if (isSpectator && !slot)
            slot = "p1";
        const targetJoinRoomId = wantsSpectator ? await resolveSpectatorRoomId(endpoint, targetRoomId) : targetRoomId;
        room = await joinMatchById(client, targetJoinRoomId, wantsSpectator ? {} : { joinToken });
        roomId = room.id;
        selfSessionId = typeof room?.sessionId === "string" ? room.sessionId : selfSessionId;
        captureMatchReconnectionToken(room);
        clearMatchReconnectTimer();
        matchReconnectAttempts = 0;
        const displayName = getDisplayName();
        if (displayName && !isSpectator) {
            room.send("set_name", { name: displayName, avatarId: getAvatarId() });
        }
        bindMatchHandlers(room, {
            onAssignSlot: (msg) => {
                isSpectator = msg?.spectator === true || isSpectator;
                slot = isSpectator ? "p1" : (msg?.slot || null);
                selfSessionId = typeof msg?.sessionId === "string" ? msg.sessionId : null;
                log("ASSIGN_SLOT", msg);
            },
            onCardPlayed: (msg) => {
                diaryCardPlayed(msg);
                const side = sideFromServerSlot((msg?.slot || ""));
                if (!side)
                    return;
                if (String(msg?.lane || "") !== "field")
                    return;
                const targetPos = Number(msg?.targetPos);
                if (!Number.isInteger(targetPos) || targetPos < 0)
                    return;
                summonedBySide[side].add(targetPos);
            },
            onEffectChoice: (msg) => {
                if (!isSpectator)
                    showEffectChoiceModal(msg);
            },
            onRevealTopCard: (msg) => {
                if (!isSpectator)
                    showRevealTopCardModal(msg);
            },
            onOpponentReconnecting: showOpponentReconnecting,
            onOpponentReconnected: showOpponentReconnected,
            onError: (msg) => log("ERROR", msg),
            onLeave: (code) => {
                hideCardChoiceModal(false);
                hideChoiceWaitingModal();
                if (isSpectator) {
                    scheduleSpectatorReconnect(code);
                    return;
                }
                scheduleMatchReconnect(code);
            },
            onLog: (name, msg) => {
                if (name === "ATTACK_RESOLVED")
                    diaryAttackResolved(msg);
                else if (name === "TURN_START")
                    diaryTurnStart(msg);
                else if (name === "EFFECT")
                    diaryEffect(msg);
                else if (name === "CHOICE_WAITING") {
                    if (!isSpectator) {
                        showChoiceWaitingModal(msg);
                        logText(`⏳ Seu oponente está escolhendo: ${String(msg?.title || "uma opção")}.`);
                    }
                }
                else if (name === "CHOICE_WAITING_END") {
                    if (!isSpectator)
                        hideChoiceWaitingModal();
                }
                else if (name === "MATCH_ENDED") {
                    const winner = ownerLabel(String(msg?.winner || ""));
                    logText(`🏁 Partida encerrada. Vencedor: ${winner}.`);
                    isMatchFinished = true;
                    hideCardChoiceModal(false);
                    hideChoiceWaitingModal();
                    const seq = Number(msg?.seq ?? -1);
                    if (seq !== lastMatchEndSeq) {
                        lastMatchEndSeq = seq;
                        const result = describeMatchEnded(msg);
                        showVictory(result);
                    }
                }
                if (name === "EFFECT") {
                    const side = sideFromServerSlot((msg?.slot || ""));
                    const effect = String(msg?.effect || "").trim();
                    if (side && ["valbrak_citizen_boost", "ademais_spider_burst", "leafae_vital_guard"].includes(effect)) {
                        animateChosenPowerActivation(side);
                    }
                }
                if (name === "TURN_START") {
                    const side = sideFromServerSlot((msg?.turnSlot || ""));
                    if (side) {
                        justUntappedBySide[side] = new Set(tappedBySide[side]);
                        justUntappedLeaderBySide[side] = tappedLeaderBySide[side];
                        tappedBySide[side].clear();
                        tappedLeaderBySide[side] = false;
                        untapPulseBySide[side] = true;
                        setTimeout(() => {
                            untapPulseBySide[side] = false;
                            justUntappedBySide[side].clear();
                            justUntappedLeaderBySide[side] = false;
                        }, 260);
                        summonedBySide[side].clear();
                    }
                }
                if (name === "ATTACK_RESOLVED") {
                    const side = sideFromServerSlot((msg?.attackerSlot || ""));
                    const attackerPos = Number(msg?.attackerPos);
                    if (!side)
                        return;
                    if (Number.isInteger(attackerPos) && attackerPos >= 0)
                        tappedBySide[side].add(attackerPos);
                    if (msg?.attackerLeader === true || msg?.attacker === "leader" || attackerPos === -1)
                        tappedLeaderBySide[side] = true;
                }
            },
            onStateSync: (state) => {
                if (String(state?.phase || "") === "FINISHED")
                    isMatchFinished = true;
                if (view.turnPhaseEl)
                    view.turnPhaseEl.textContent = formatPhaseLabel(state?.game?.phase);
                if (view.roomIdViewEl)
                    view.roomIdViewEl.textContent = roomId ?? "—";
                if (view.slotEl)
                    view.slotEl.textContent = isSpectator ? "Espectador" : (slot ?? "—");
                if (view.turnEl)
                    view.turnEl.textContent = String(state?.game?.turn ?? "—");
                if (view.turnSlotEl)
                    view.turnSlotEl.textContent = String(state?.game?.turnSlot ?? "—");
                if (view.p1HpEl)
                    view.p1HpEl.textContent = String(state?.game?.p1?.hp ?? "—");
                if (view.p2HpEl)
                    view.p2HpEl.textContent = String(state?.game?.p2?.hp ?? "—");
                if (view.p1FragmentsEl)
                    view.p1FragmentsEl.textContent = String(state?.game?.p1?.fragments ?? "—");
                if (view.p2FragmentsEl)
                    view.p2FragmentsEl.textContent = String(state?.game?.p2?.fragments ?? "—");
                if (view.p1HandCountEl)
                    view.p1HandCountEl.textContent = String(state?.game?.p1?.hand?.length ?? "—");
                if (view.p2HandCountEl)
                    view.p2HandCountEl.textContent = String(state?.game?.p2?.hand?.length ?? "—");
                if (isSpectator && !slot)
                    slot = "p1";
                if (!slot && !isSpectator)
                    slot = inferSlotFromState(state);
                if (!slot)
                    return;
                syncArenaPlayerNames(state);
                syncHandTitles(state);
                const previousMyField = currentMyField.slice();
                const previousMyFieldHp = currentMyFieldHp.slice();
                const previousMySupport = currentMySupport.slice();
                const previousMyEnv = currentMyEnv;
                const previousMyGrave = currentMyGrave.slice();
                const previousMyBanished = currentMyBanished.slice();
                const previousMyHand = previousHandCards.youHand.slice();
                let myHandTransferSnapshots = new Map();
                const previousEnemyHand = previousHandCards.aiHand.slice();
                let enemyHandTransferSnapshots = new Map();
                const previousEnemyField = currentEnemyField.slice();
                const previousEnemyFieldHp = currentEnemyFieldHp.slice();
                const previousEnemySupport = currentEnemySupport.slice();
                const previousEnemyGrave = currentEnemyGrave.slice();
                const previousEnemyBanished = currentEnemyBanished.slice();
                let boardTransferSnapshots = new Map();
                const previousMyLeader = currentMyLeader;
                const previousMyLeaderHp = currentMyLeaderHp;
                const previousEnemyLeader = currentEnemyLeader;
                const previousEnemyLeaderHp = currentEnemyLeaderHp;
                const my = slot === "p1" ? state?.game?.p1 : state?.game?.p2;
                const enemy = slot === "p1" ? state?.game?.p2 : state?.game?.p1;
                currentMyFragments = Number(my?.fragments ?? 0);
                currentEnemyFragments = Number(enemy?.fragments ?? 0);
                const turnMarker = `${String(state?.game?.turn || "")}::${String(state?.game?.turnSlot || "")}`;
                if (turnMarker !== lastTurnMarker) {
                    lastTurnMarker = turnMarker;
                    const startedSide = sideFromServerSlot((state?.game?.turnSlot || ""));
                    if (startedSide === "you")
                        myTurnCount += 1;
                    if (startedSide === "ai")
                        enemyTurnCount += 1;
                }
                const hand = asStringArray(my?.hand);
                currentMyHand = hand.slice();
                currentMyDeck = asStringArray(my?.deck);
                currentMyGrave = asStringArray(my?.grave);
                currentMyBanished = asStringArray(my?.banished || my?.ban);
                const myField = asStringArray(my?.field);
                const myFieldHp = asNumberArray(my?.fieldHp);
                const myFieldAtkTemp = asNumberArray(my?.fieldAtkTemp);
                const myFieldAtkPerm = asNumberArray(my?.fieldAtkPerm);
                const myFieldAcPerm = asNumberArray(my?.fieldAcPerm);
                const myFieldBlessing = asNumberArray(my?.fieldBlessing);
                const myFieldBlood = asNumberArray(my?.fieldBloodMarks);
                const myFieldVital = asNumberArray(my?.fieldVitalMarks);
                const myFieldTapped = asBoolArray(my?.fieldTapped);
                tappedBySide.you.clear();
                for (let i = 0; i < myFieldTapped.length; i += 1)
                    if (myFieldTapped[i])
                        tappedBySide.you.add(i);
                currentMyField = myField;
                currentMyFieldHp = myFieldHp;
                currentMyFieldAtkTemp = myFieldAtkTemp;
                currentMyFieldAtkPerm = myFieldAtkPerm;
                currentMyFieldAcPerm = myFieldAcPerm;
                currentMyFieldBlessing = myFieldBlessing;
                currentMyFieldBloodMarks = myFieldBlood;
                currentMyFieldVitalMarks = myFieldVital;
                const mySupport = asStringArray(my?.support);
                currentMySupport = mySupport;
                currentMySupportAttach = asNumberArray(my?.supportAttachTo);
                currentMySupportCounters = asNumberArray(my?.supportCounters);
                currentMyEnv = String(my?.env || "") || null;
                currentMyLeader = String(my?.leaderId || "");
                currentMySleeve = String(my?.sleeveId || "");
                currentMyPlaymat = String(my?.playmatId || "");
                currentMyLeaderHp = Number(my?.hp ?? 0);
                currentMyLeaderTapped = !!my?.leaderTapped;
                currentMyLeaderBlessing = Number(my?.leaderBlessing || 0);
                currentMyLeaderVitalMarks = Number(my?.leaderVitalMarks || 0);
                currentMyLeaderSpiderMarks = Number(my?.leaderSpiderMarks || 0);
                const enemyField = asStringArray(enemy?.field);
                currentEnemyDeck = asStringArray(enemy?.deck);
                currentEnemyGrave = asStringArray(enemy?.grave);
                currentEnemyBanished = asStringArray(enemy?.banished || enemy?.ban);
                const enemyFieldHp = asNumberArray(enemy?.fieldHp);
                const enemyFieldAtkTemp = asNumberArray(enemy?.fieldAtkTemp);
                const enemyFieldAtkPerm = asNumberArray(enemy?.fieldAtkPerm);
                const enemyFieldAcPerm = asNumberArray(enemy?.fieldAcPerm);
                const enemyFieldBlessing = asNumberArray(enemy?.fieldBlessing);
                const enemyFieldBlood = asNumberArray(enemy?.fieldBloodMarks);
                const enemyFieldVital = asNumberArray(enemy?.fieldVitalMarks);
                const enemyFieldTapped = asBoolArray(enemy?.fieldTapped);
                tappedBySide.ai.clear();
                for (let i = 0; i < enemyFieldTapped.length; i += 1)
                    if (enemyFieldTapped[i])
                        tappedBySide.ai.add(i);
                currentEnemyField = enemyField;
                currentEnemyFieldHp = enemyFieldHp;
                currentEnemyFieldAtkTemp = enemyFieldAtkTemp;
                currentEnemyFieldAtkPerm = enemyFieldAtkPerm;
                currentEnemyFieldAcPerm = enemyFieldAcPerm;
                currentEnemyFieldBlessing = enemyFieldBlessing;
                currentEnemyFieldBloodMarks = enemyFieldBlood;
                currentEnemyFieldVitalMarks = enemyFieldVital;
                const enemySupport = asStringArray(enemy?.support);
                currentEnemySupport = enemySupport;
                currentEnemySupportAttach = asNumberArray(enemy?.supportAttachTo);
                currentEnemySupportCounters = asNumberArray(enemy?.supportCounters);
                const enemyEnv = String(enemy?.env || "") || null;
                currentEnemyEnv = enemyEnv;
                currentEnemySleeve = String(enemy?.sleeveId || "");
                currentEnemyPlaymat = String(enemy?.playmatId || "");
                currentEnemyLeader = String(enemy?.leaderId || "");
                currentEnemyLeaderHp = Number(enemy?.hp ?? 0);
                currentEnemyLeaderTapped = !!enemy?.leaderTapped;
                currentEnemyLeaderBlessing = Number(enemy?.leaderBlessing || 0);
                currentEnemyLeaderVitalMarks = Number(enemy?.leaderVitalMarks || 0);
                currentEnemyLeaderSpiderMarks = Number(enemy?.leaderSpiderMarks || 0);
                const myHandChanged = !sameStringArray(previousMyHand, hand);
                const enemyHandCount = Number(enemy?.hand?.length ?? 0);
                const enemyHandChanged = previousEnemyHand.length !== enemyHandCount;
                const myBoardChanged = !sameStringArray(previousMyField, myField) || !sameStringArray(previousMySupport, mySupport) || !sameStringArray(previousMyGrave, currentMyGrave) || !sameStringArray(previousMyBanished, currentMyBanished);
                const enemyBoardChanged = !sameStringArray(previousEnemyField, enemyField) || !sameStringArray(previousEnemySupport, enemySupport) || !sameStringArray(previousEnemyGrave, currentEnemyGrave) || !sameStringArray(previousEnemyBanished, currentEnemyBanished);
                if (myHandChanged)
                    myHandTransferSnapshots = captureHandTransferSnapshots("youHand");
                if (enemyHandChanged)
                    enemyHandTransferSnapshots = captureHandTransferSnapshots("aiHand");
                if (myBoardChanged || enemyBoardChanged)
                    boardTransferSnapshots = captureLaneTransferSnapshots(["you-field", "you-support", "ai-field", "ai-support"]);
                const myBoardCardsToPiles = getBoardCardsMovingToPiles(previousMyField, myField, previousMySupport, mySupport, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished);
                const enemyBoardCardsToPiles = getBoardCardsMovingToPiles(previousEnemyField, enemyField, previousEnemySupport, enemySupport, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished);
                queueLanePileFlights("you-field", myBoardCardsToPiles.field);
                queueLanePileFlights("you-support", myBoardCardsToPiles.support);
                queueLanePileFlights("ai-field", enemyBoardCardsToPiles.field);
                queueLanePileFlights("ai-support", enemyBoardCardsToPiles.support);
                const myShadowPenalty = hasShadowPenaltyForPlayer(my, currentMyLeader, currentMyEnv, enemyEnv);
                const enemyShadowPenalty = hasShadowPenaltyForPlayer(enemy, currentEnemyLeader, enemyEnv, currentMyEnv);
                const myTurn = !isSpectator && String(state?.game?.turnSlot || "") === slot;
                isMatchFinished = String(state?.phase || "IN_MATCH") === "FINISHED";
                const phase = String(state?.game?.phase || "");
                if (phase !== currentPhase) {
                    resetBoardAttackSelection();
                    cancelBoardAttackSelection();
                    animatePhaseChange(phase);
                }
                isMyTurn = myTurn;
                currentPhase = phase;
                syncInitiativeUi(state);
                syncMulliganUi(state, hand);
                applyArenaPlaymats();
                updateArenaTurnPriority(myTurn);
                if (!myTurn || phase !== "COMBAT") {
                    resetBoardAttackSelection();
                    cancelBoardAttackSelection();
                }
                renderFragments("you-fragsDock", my?.fragments, my?.fragmentMax, getFragImage(my), myShadowPenalty);
                renderFragments("ai-fragsDock", enemy?.fragments, enemy?.fragmentMax, getFragImage(enemy), enemyShadowPenalty);
                renderLeaderSlot("you-leader", String(my?.leaderId || ""), Number(my?.hp ?? 0));
                renderLeaderSlot("ai-leader", String(enemy?.leaderId || ""), Number(enemy?.hp ?? 0));
                const myLeaderSlot = document.getElementById("you-leader");
                if (myLeaderSlot)
                    myLeaderSlot.onclick = null;
                const enemyLeaderSlot = document.getElementById("ai-leader");
                if (enemyLeaderSlot) {
                    clearAttackTargetHover(enemyLeaderSlot);
                    enemyLeaderSlot.onclick = () => {
                        if (!canSelectCombatTarget({ type: "leader", side: "ai" }))
                            return;
                        resolveSelectedBoardAttack({ type: "leader", side: "ai" });
                    };
                    if (canSelectCombatTarget({ type: "leader", side: "ai" })) {
                        enemyLeaderSlot.__attackHoverCleanup = bindAttackTargetHover(enemyLeaderSlot);
                    }
                }
                renderEnvSlot("you-env", currentMyEnv, true);
                renderEnvSlot("ai-env", enemyEnv, false);
                renderPileCounts("you", my);
                renderPileCounts("ai", enemy);
                const pileModal = document.getElementById("pileModal");
                if (pileModal && pileModal.style.display === "flex")
                    renderPileModal();
                renderSideHand("aiHand", Array.from({ length: enemyHandCount }, (_, index) => `opp-${index}`), false);
                if (selectedHandCardId && !hand.includes(selectedHandCardId))
                    selectedHandCardId = null;
                if (selectedAttackerPos !== null && (selectedAttackerPos < 0 || selectedAttackerPos >= myField.length))
                    selectedAttackerPos = null;
                if (selectedTargetType === "ally" && (selectedTargetPos === null || selectedTargetPos >= enemyField.length)) {
                    selectedTargetType = "leader";
                    selectedTargetPos = null;
                    if (view.selectedTargetEl)
                        view.selectedTargetEl.textContent = "Líder inimigo";
                }
                renderHand(hand);
                renderMyField(myField, myFieldHp);
                renderMySupport(mySupport);
                renderEnemyField(enemyField, enemyFieldHp);
                renderEnemySupport(enemySupport);
                animateVisibleHandTransfers(myHandTransferSnapshots, "you", previousMyHand, hand, previousMyField, myField, previousMySupport, mySupport, previousMyEnv, currentMyEnv, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished);
                animateHiddenHandTransfers(enemyHandTransferSnapshots, "ai", previousEnemyHand, previousHandCards.aiHand, previousEnemyField, enemyField, previousEnemySupport, enemySupport, null, enemyEnv, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished);
                animateBoardPileTransfers(boardTransferSnapshots, "you-field", "you-support", previousMyField, myField, previousMySupport, mySupport, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished, document.querySelector("#you-grave > .deckVisualCard:last-of-type") || document.getElementById("you-grave"), document.querySelector("#you-banished > .deckVisualCard:last-of-type") || document.getElementById("you-banished"));
                animateBoardPileTransfers(boardTransferSnapshots, "ai-field", "ai-support", previousEnemyField, enemyField, previousEnemySupport, enemySupport, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished, document.querySelector("#ai-grave > .deckVisualCard:last-of-type") || document.getElementById("ai-grave"), document.querySelector("#ai-banished > .deckVisualCard:last-of-type") || document.getElementById("ai-banished"));
                animateFieldDamage("you", previousMyField, myField, previousMyFieldHp, myFieldHp);
                animateFieldDamage("ai", previousEnemyField, enemyField, previousEnemyFieldHp, enemyFieldHp);
                animateLeaderDamage("you-leader", previousMyLeader, currentMyLeader, previousMyLeaderHp, currentMyLeaderHp);
                animateLeaderDamage("ai-leader", previousEnemyLeader, currentEnemyLeader, previousEnemyLeaderHp, currentEnemyLeaderHp);
                setInspector(hoveredInspectorView || selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId, side: "you", lane: "hand" } : null));
                if (view.btnPlay)
                    view.btnPlay.disabled = isSpectator || !(myTurn && phase === "PREP" && !!selectedHandCardId);
                if (view.btnLeaderPower) {
                    const showLeaderPower = hasManualLeaderPower(currentMyLeader);
                    const leaderPowerReady = showLeaderPower && canUseLeaderPower();
                    view.btnLeaderPower.style.display = !isSpectator && showLeaderPower ? "" : "none";
                    view.btnLeaderPower.disabled = !leaderPowerReady;
                    view.btnLeaderPower.classList.toggle("is-ready", leaderPowerReady);
                }
                if (view.btnAttack)
                    view.btnAttack.disabled = isSpectator || !(myTurn && phase === "COMBAT" && selectedAttackerPos !== null);
                if (view.btnTargetLeader)
                    view.btnTargetLeader.disabled = isSpectator || !(myTurn && phase === "COMBAT");
                if (view.btnNextPhase)
                    view.btnNextPhase.disabled = isSpectator || !myTurn || phase === "MULLIGAN";
                if (view.btnEndTurn)
                    view.btnEndTurn.disabled = isSpectator || !(myTurn && phase === "END");
            }
        });
        log("JOINED", { roomId });
        if (isSpectator) {
            logText("Modo espectador ativo. Mãos e decks ficam ocultos; cemitério e banidas são públicos.");
        }
    }
    finally {
        isJoining = false;
    }
}
if (view.btnJoin)
    view.btnJoin.onclick = () => void joinMatch();
const initiativeRollButton = document.getElementById("initiativeRollButton");
const initiativeStartFirstButton = document.getElementById("initiativeStartFirstButton");
const initiativeStartSecondButton = document.getElementById("initiativeStartSecondButton");
if (initiativeRollButton)
    initiativeRollButton.onclick = () => !isSpectator && room?.send("roll_initiative");
if (initiativeStartFirstButton)
    initiativeStartFirstButton.onclick = () => !isSpectator && room?.send("choose_starter", { starterSlot: slot });
if (initiativeStartSecondButton)
    initiativeStartSecondButton.onclick = () => !isSpectator && room?.send("choose_starter", { starterSlot: slot === "p1" ? "p2" : "p1" });
if (view.btnPlay)
    view.btnPlay.onclick = () => !isSpectator && selectedHandCardId && tryPlayCard(selectedHandCardId);
if (view.btnLeaderPower)
    view.btnLeaderPower.onclick = () => {
        if (isSpectator)
            return;
        if (!canUseLeaderPower())
            return;
        animateChosenPowerActivation("you");
        room?.send("leader_power");
    };
if (view.btnAttack)
    view.btnAttack.onclick = () => {
        if (isSpectator)
            return;
        if (!isMyTurn || currentPhase !== "COMBAT")
            return;
        if (selectedAttackerPos === null)
            return;
        if (selectedTargetType === "ally" && selectedTargetPos !== null)
            return resolveSelectedBoardAttack({ type: "ally", side: "ai", index: selectedTargetPos });
        resolveSelectedBoardAttack({ type: "leader", side: "ai" });
    };
if (view.btnTargetLeader)
    view.btnTargetLeader.onclick = () => {
        if (isSpectator)
            return;
        if (!isMyTurn || currentPhase !== "COMBAT")
            return;
        selectedTargetType = "leader";
        selectedTargetPos = null;
        if (view.selectedTargetEl)
            view.selectedTargetEl.textContent = "Líder inimigo";
    };
const attackConfirmEls = getAttackConfirmEls();
if (attackConfirmEls.btnNo)
    attackConfirmEls.btnNo.onclick = hideAttackConfirmModal;
if (attackConfirmEls.btnYes)
    attackConfirmEls.btnYes.onclick = confirmPendingBoardAttack;
if (attackConfirmEls.modal) {
    attackConfirmEls.modal.addEventListener("click", (event) => {
        if (event.target === attackConfirmEls.modal)
            hideAttackConfirmModal();
    });
}
if (view.btnNextPhase)
    view.btnNextPhase.onclick = () => !isSpectator && room?.send("next_phase");
if (view.btnEndTurn)
    view.btnEndTurn.onclick = () => !isSpectator && room?.send("end_turn");
if (view.btnConcede)
    view.btnConcede.onclick = () => {
        if (isSpectator || isMatchFinished || !room)
            return;
        if (window.confirm("Conceder a partida? O oponente vencerá automaticamente."))
            room.send("concede");
    };
if (view.btnBackLobby)
    view.btnBackLobby.onclick = goLobby;
const logModal = document.getElementById("logModal");
const btnOpenLog = document.getElementById("btnOpenLog");
const btnCloseLogModal = document.getElementById("btnCloseLogModal");
function hideLogModal() {
    if (!logModal)
        return;
    logModal.style.display = "none";
}
function showLogModal() {
    if (!logModal)
        return;
    logModal.style.display = "flex";
}
if (btnOpenLog)
    btnOpenLog.onclick = showLogModal;
if (btnCloseLogModal)
    btnCloseLogModal.onclick = hideLogModal;
if (logModal) {
    logModal.addEventListener("click", (event) => {
        if (event.target === logModal)
            hideLogModal();
    });
}
window.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
        hideLogModal();
});
window.hideCardChoice = () => hideCardChoiceModal(true);
window.minimizeCardChoice = () => minimizeCardChoiceModal();
window.hidePile = () => hidePile();
window.submitMulligan = () => submitMulliganSelection();
window.hideVictory = hideVictory;
const cardChoiceRestoreButton = document.getElementById("cardChoiceRestoreButton");
if (cardChoiceRestoreButton)
    cardChoiceRestoreButton.onclick = () => restoreCardChoiceModal();
bindPileSlots();
const params = new URLSearchParams(window.location.search);
if (view.endpointEl)
    view.endpointEl.value = resolveServerEndpoint(window.location.search);
if (view.roomIdEl)
    view.roomIdEl.value = params.get("roomId")?.trim() || "";
if (view.roomIdEl?.value)
    void joinMatch();
