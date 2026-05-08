/* Responsibility: wire Match UI with Colyseus network. This is the only place combining UI + NET. */

import { bindMatchHandlers, connectClient, joinMatchById, resolveSpectatorRoomId } from "../net/mp";
import { animateCardTransfer, animateEl, bindAttackTargetHover, setChosenReady, setupAttackArrow, startAttackArrow, stopAttackArrow } from "../animations/animationHelpers";
import { getGameInputs, log, logText, renderButtonRow } from "../ui/gameView";
import { setupBoardScale } from "../ui/boardScale";
import { setupArenaSlots } from "../ui/arenaSlots";
import { getDisplayName } from "../ui/profile";
import { resolveServerEndpoint } from "../config/runtime";
import { canAttackCardQuiet, canAttackTargetQuiet, endAttackCleanup, resolveAttackOn, selectAttacker, type AttackSelection, type AttackTarget as BattleTarget, type BattleCard, type BattleRuntime, type BattleSide } from "../game/battle";

type CardDef = {
	name: string;
	key?: string;
	aliases?: string[];
	img?: string;
	kind?: string;
	effect?: string;
	effectA?: string;
	effectB?: string;
	cost?: number;
	tipo?: string;
	classe?: string;
	filiacao?: string;
	hp?: number;
	atkBonus?: number;
	damage?: number;
	ac?: number;
	description?: string;
	text?: string;
};

type InspectorLane = NonNullable<InspectorView["lane"]>;

type InspectorView = {
	cardId: string;
	side?: BattleSide;
	lane?: "hand" | "field" | "support" | "leader" | "env" | "deck" | "grave" | "banished";
	index?: number | null;
};

const view = getGameInputs();
setupBoardScale();
setupArenaSlots();
setupAttackArrow();

const previousLaneCards: Record<"you-field" | "ai-field" | "you-support" | "ai-support", string[]> = {
	"you-field": [],
	"ai-field": [],
	"you-support": [],
	"ai-support": []
};

const pendingLanePileFlights: Record<"you-field" | "ai-field" | "you-support" | "ai-support", Map<string, number>> = {
	"you-field": new Map<string, number>(),
	"ai-field": new Map<string, number>(),
	"you-support": new Map<string, number>(),
	"ai-support": new Map<string, number>()
};

const previousHandCards: Record<"youHand" | "aiHand", string[]> = {
	"youHand": [],
	"aiHand": []
};

type HandTransferSnapshot = {
	cardId: string;
	originRect: DOMRect;
	imageSrc: string;
};

type LaneTransferSnapshot = {
	cardId: string;
	originRect: DOMRect;
	imageSrc: string;
	zoneId: "you-field" | "ai-field" | "you-support" | "ai-support";
};

const cardDefs = (window as Window & { CARD_DEFS?: CardDef[] }).CARD_DEFS ?? [];
const cardLookup = new Map<string, CardDef>();
const CARD_BACK_ASSET = "ui/layout-background.ai.png";

function envAliasesForCard(card: CardDef): string[] {
	const normalizedName = normalizeCardId(String(card?.name || ""));
	if (normalizedName === "tempestadearcana") return ["tempestadearcana", "tempestadearcanaenv"];
	if (normalizedName === "camposensanguentados") return ["camposensanguentados", "campoensanguentado", "camposbg"];
	if (normalizedName === "caminhodassombras") return ["caminhosdassombras", "caminhodassombras"];
	if (normalizedName === "catedralensolarada") return ["catedralensolarada"];
	return [];
}

for (const card of cardDefs) {
	if (!card?.name) continue;
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
		if (normalized && !cardLookup.has(normalized)) cardLookup.set(normalized, card);
	}
}

let client: any = null;
let room: any = null;
let slot: "p1" | "p2" | null = null;
let roomId: string | null = null;
let selfSessionId: string | null = null;
let isSpectator = false;
let spectatorMatchRoomId: string | null = null;
let spectatorReconnectAttempts = 0;
let spectatorReconnectTimer: number | null = null;
let selectedHandCardId: string | null = null;
let selectedInspectorView: InspectorView | null = null;
let hoveredInspectorView: InspectorView | null = null;
let selectedAttackerPos: number | null = null;
let selectedTargetType: "leader" | "ally" = "leader";
let selectedTargetPos: number | null = null;
let isJoining = false;
let currentPhase = "INITIAL";
let isMyTurn = false;
let currentMyField: string[] = [];
let currentMyFieldHp: number[] = [];
let currentMyFieldAtkTemp: number[] = [];
let currentMyFieldAtkPerm: number[] = [];
let currentMyFieldAcPerm: number[] = [];
let currentMyFieldBlessing: number[] = [];
let currentMyFieldBloodMarks: number[] = [];
let currentMyFieldVitalMarks: number[] = [];
let currentEnemyField: string[] = [];
let currentEnemyFieldHp: number[] = [];
let currentEnemyFieldAtkTemp: number[] = [];
let currentEnemyFieldAtkPerm: number[] = [];
let currentEnemyFieldAcPerm: number[] = [];
let currentEnemyFieldBlessing: number[] = [];
let currentEnemyFieldBloodMarks: number[] = [];
let currentEnemyFieldVitalMarks: number[] = [];
let currentMySupport: string[] = [];
let currentEnemySupport: string[] = [];
let currentMySupportAttach: number[] = [];
let currentEnemySupportAttach: number[] = [];
let currentMySupportCounters: number[] = [];
let currentEnemySupportCounters: number[] = [];
let currentMyEnv: string | null = null;
let currentEnemyEnv: string | null = null;
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
let currentMyFragments = 0;
let currentEnemyFragments = 0;
let currentMyDeck: string[] = [];
let currentEnemyDeck: string[] = [];
let currentMyGrave: string[] = [];
let currentEnemyGrave: string[] = [];
let currentMyBanished: string[] = [];
let currentEnemyBanished: string[] = [];
let activeChoiceId: string | null = null;
let activeChoiceTimer: number | null = null;
let activeWaitingTimer: number | null = null;
let activePileSide: BattleSide = "you";
let activePileWhich: "deck" | "grave" | "banished" = "deck";
let myTurnCount = 0;
let enemyTurnCount = 0;
let lastTurnMarker = "";
let lastMatchEndSeq = -1;
let revealHideTimer: number | null = null;

function animateChosenPowerActivation(side: BattleSide): void {
	const leaderSlotId = side === "you" ? "you-leader" : "ai-leader";
	animateEl(document.querySelector(`#${leaderSlotId} > .card`), "anim-power");
	if (side === "you") animateEl(view.btnLeaderPower, "anim-power");
}

function animatePileEntryIfNeeded(slotId: string, previousCards: string[], nextCards: string[]): void {
	if (nextCards.length <= previousCards.length) return;
	const slotEl = document.getElementById(slotId);
	if (!slotEl) return;
	animateEl(slotEl.querySelector(":scope > .deckVisualCard:last-of-type"), "anim-pile-in");
	animateEl(slotEl.querySelector(":scope > .slotCount"), "anim-pile-in");
}

const tappedBySide: Record<BattleSide, Set<number>> = {
	you: new Set<number>(),
	ai: new Set<number>()
};

const tappedLeaderBySide: Record<BattleSide, boolean> = {
	you: false,
	ai: false
};

const untapPulseBySide: Record<BattleSide, boolean> = {
	you: false,
	ai: false
};

const justUntappedBySide: Record<BattleSide, Set<number>> = {
	you: new Set<number>(),
	ai: new Set<number>()
};

const justUntappedLeaderBySide: Record<BattleSide, boolean> = {
	you: false,
	ai: false
};

const summonedBySide: Record<BattleSide, Set<number>> = {
	you: new Set<number>(),
	ai: new Set<number>()
};

function sideFromServerSlot(serverSlot: "p1" | "p2" | null): BattleSide | null {
	if (!slot || !serverSlot) return null;
	if (serverSlot === slot) return "you";
	return "ai";
}

function currentBattlePhase(): string {
	return String(currentPhase || "INITIAL").toUpperCase() === "COMBAT" ? "battle" : "other";
}

function ownerLabel(serverSlotRaw: string): string {
	if (isSpectator) return serverSlotRaw === "p2" ? "Jogador 2" : "Jogador 1";
	const side = sideFromServerSlot((serverSlotRaw || "") as "p1" | "p2");
	return side === "you" ? "Você" : "Oponente";
}

function cardHasFiliation(cardId: string, expected: string): boolean {
	const card = resolveCard(cardId);
	const probe = normalizeKind(expected);
	const source = normalizeKind(`${String(card?.filiacao || "")} ${String(card?.classe || "")}`);
	return !!probe && source.includes(probe);
}

function isShadowPenaltyEnvCard(cardId: string | null | undefined): boolean {
	const card = resolveCard(String(cardId || ""));
	if (String(card?.effect || "") === "sombra_penalty") return true;
	const normalized = normalizeCardId(String(card?.name || cardId || ""));
	return normalized === "caminhodassombras" || normalized === "caminhosdassombras" || normalized === "caminhosperigosos";
}

function hasShadowPenaltyForPlayer(playerState: any, leaderId: string, ownEnv: string | null, enemyEnv: string | null): boolean {
	if (!isShadowPenaltyEnvCard(ownEnv) && !isShadowPenaltyEnvCard(enemyEnv)) return false;
	if (cardHasFiliation(leaderId, "Sombras")) return false;
	return !normalizeKind(String(playerState?.filiacao || "")).includes("sombras");
}

type VictoryView = {
	title: string;
	text: string;
	mode: "win" | "lose" | "neutral";
};

function victoryBannerForLeader(mode: "win" | "lose" | "neutral"): string | null {
	if (mode === "neutral") return null;
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
		return mode === "win" ? "win_lose/valbrakvitoria.png" : "win_lose/valbrakderrota.png";
	}
	if (probes.some((value) => value.includes("katsu"))) {
		return mode === "win" ? "win_lose/katsuvitoria (1).png" : "win_lose/katsuvitoria (2).png";
	}
	if (probes.some((value) => value.includes("leafae"))) {
		return mode === "win" ? "win_lose/leafaevitoria.png" : "win_lose/leafaederrota.png";
	}
	if (probes.some((value) => value.includes("ademais"))) {
		return mode === "win" ? "win_lose/Ademaisvitoria.png" : "win_lose/ademaisderrota.png";
	}
	return null;
}

function describeMatchEnded(msg: any): VictoryView {
	const winnerSlot = String(msg?.winner || "");
	const loserSlot = String(msg?.loser || "");
	const reason = String(msg?.reason || "hp_zero");
	const youWon = !!slot && winnerSlot === slot;
	const youLost = !!slot && loserSlot === slot;
	const title = youWon ? "Você ganhou" : youLost ? "Você perdeu" : "Fim de jogo";
	if (reason === "deckout") {
		if (youWon) return { title, text: "Você ganhou porque o oponente tentou comprar carta com o deck vazio.", mode: "win" };
		if (youLost) return { title, text: "Você perdeu porque tentou comprar carta com o deck vazio.", mode: "lose" };
		return { title, text: "A partida terminou por deck vazio.", mode: "neutral" };
	}
	if (reason === "inactivity") {
		if (youWon) return { title, text: "Você ganhou por inatividade do oponente após 120 segundos sem ação.", mode: "win" };
		if (youLost) return { title, text: "Você perdeu por inatividade após 120 segundos sem ação.", mode: "lose" };
		return { title, text: "A partida terminou por inatividade.", mode: "neutral" };
	}
	if (reason === "opponent_left") {
		if (youWon) return { title, text: "Você ganhou porque o oponente saiu da sala.", mode: "win" };
		if (youLost) return { title, text: "Você perdeu porque saiu da sala.", mode: "lose" };
		return { title, text: "A partida terminou porque um jogador saiu da sala.", mode: "neutral" };
	}
	if (youWon) return { title, text: "Você venceu ao reduzir a vida do Escolhido inimigo a zero.", mode: "win" };
	if (youLost) return { title, text: "Você perdeu porque a vida do seu Escolhido chegou a zero.", mode: "lose" };
	const winner = ownerLabel(winnerSlot);
	return { title, text: `${winner} venceu a partida.`, mode: "neutral" };
}

function showVictory(viewState: VictoryView): void {
	const modal = document.getElementById("victoryModal") as HTMLElement | null;
	const titleEl = document.getElementById("victoryTitle");
	const textEl = document.getElementById("victoryText");
	const imageWrapEl = document.getElementById("victoryMedia") as HTMLElement | null;
	const imageEl = document.getElementById("victoryImage") as HTMLImageElement | null;
	if (!modal || !titleEl || !textEl || !imageWrapEl || !imageEl) return;
	const bannerSrc = victoryBannerForLeader(viewState.mode);
	titleEl.textContent = viewState.title;
	textEl.textContent = viewState.text;
	if (bannerSrc) {
		imageEl.src = bannerSrc;
		imageEl.alt = `${viewState.title} - arte do Escolhido`;
		imageWrapEl.style.display = "block";
	}
	else {
		imageEl.removeAttribute("src");
		imageEl.alt = "";
		imageWrapEl.style.display = "none";
	}
	modal.style.display = "flex";
}

function hideVictory(): void {
	const modal = document.getElementById("victoryModal") as HTMLElement | null;
	if (modal) modal.style.display = "none";
}

function ensureRevealModal(): { modal: HTMLElement; title: HTMLElement; text: HTMLElement; img: HTMLImageElement } | null {
	let modal = document.getElementById("topRevealModal") as HTMLElement | null;
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
		box.style.width = "min(90vw, 340px)";
		box.style.background = "#141821";
		box.style.border = "1px solid rgba(255,255,255,.12)";
		box.style.borderRadius = "12px";
		box.style.padding = "16px";
		box.style.boxShadow = "0 16px 48px rgba(0,0,0,.45)";
		box.style.display = "grid";
		box.style.gap = "10px";
		const title = document.createElement("div");
		title.id = "topRevealTitle";
		title.style.fontSize = "16px";
		title.style.fontWeight = "700";
		const text = document.createElement("div");
		text.id = "topRevealText";
		text.style.fontSize = "13px";
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
	const title = document.getElementById("topRevealTitle") as HTMLElement | null;
	const text = document.getElementById("topRevealText") as HTMLElement | null;
	const img = document.getElementById("topRevealImg") as HTMLImageElement | null;
	if (!modal || !title || !text || !img) return null;
	return { modal, title, text, img };
}

function hideRevealModal(): void {
	const modal = document.getElementById("topRevealModal") as HTMLElement | null;
	if (modal) modal.style.display = "none";
	if (revealHideTimer) {
		window.clearTimeout(revealHideTimer);
		revealHideTimer = null;
	}
}

function showRevealTopCardModal(payload: any): void {
	const ui = ensureRevealModal();
	if (!ui) return;
	const cardId = String(payload?.cardId || "");
	if (!cardId) return;
	const card = resolveCard(cardId);
	const owner = ownerLabel(String(payload?.ownerSlot || ""));
	const source = String(payload?.sourceCardId || "Carta");
	ui.title.textContent = `Topo revelado de ${owner}`;
	ui.text.textContent = `${source} revelou ${card?.name || cardId}.`;
	ui.img.src = asAssetPath(card?.img || CARD_BACK_ASSET);
	ui.img.alt = card?.name || cardId;
	ui.img.onerror = () => {
		ui.img.src = asAssetPath(CARD_BACK_ASSET);
	};
	ui.modal.style.display = "flex";
	if (revealHideTimer) window.clearTimeout(revealHideTimer);
	revealHideTimer = window.setTimeout(() => hideRevealModal(), 5000);
}

function diaryCardPlayed(msg: any): void {
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

function diaryAttackResolved(msg: any): void {
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

function diaryEffect(msg: any): void {
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

function diaryTurnStart(msg: any): void {
	const turnOwner = ownerLabel(String(msg?.turnSlot || ""));
	const add = Number(msg?.add || 0);
	const gainText = add > 0 ? ` e recebeu ${add} fragmento${add === 1 ? "" : "s"}` : "";
	logText(`🔄 Turno de ${turnOwner}${gainText}.`);
}

function normalizeCardId(value: string): string {
	return String(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

function basenameNoExt(value: string): string {
	const normalized = String(value || "").replace(/\\/g, "/");
	const file = normalized.split("/").pop() || "";
	return file.replace(/\.[a-z0-9]+$/i, "");
}

function basenameCardKey(value: string): string {
	return basenameNoExt(basenameNoExt(value));
}

function pathNoAssetsPrefix(value: string): string {
	return String(value || "")
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/^assets\//i, "")
		.replace(/^public\//i, "");
}

function resolveCard(cardId: string): CardDef | undefined {
	const raw = String(cardId || "");
	const direct = cardLookup.get(normalizeCardId(raw));
	if (direct) return direct;
	const clean = pathNoAssetsPrefix(raw);
	const byClean = cardLookup.get(normalizeCardId(clean));
	if (byClean) return byClean;
	const byBase = cardLookup.get(normalizeCardId(basenameNoExt(clean)));
	if (byBase) return byBase;
	const byStem = cardLookup.get(normalizeCardId(basenameCardKey(clean)));
	if (byStem) return byStem;
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
		if (!expected) continue;
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

function normalizeKind(value: string | undefined): string {
	return String(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();
}

function getCardKind(cardId: string): string {
	const card = resolveCard(cardId);
	const raw = card?.kind || card?.tipo || "";
	const normalized = normalizeKind(raw);
	if (normalized === "ally" || normalized === "aliado") return "ally";
	if (normalized === "equip" || normalized === "equipamento") return "equip";
	if (normalized === "spell" || normalized === "magia") return "spell";
	if (normalized === "truque" || normalized === "trick") return "truque";
	if (normalized === "env" || normalized === "ambiente") return "env";
	return normalized || "spell";
}

function laneForCard(cardId: string): "field" | "support" | "env" {
	const kind = getCardKind(cardId);
	if (kind === "env") return "env";
	return kind === "ally" ? "field" : "support";
}

function appendCostBadge(container: HTMLElement, cost: number | undefined): void {
	if (!Number.isFinite(cost)) return;
	const badge = document.createElement("div");
	badge.className = "costTag";
	const value = document.createElement("span");
	value.textContent = String(cost);
	badge.appendChild(value);
	container.appendChild(badge);
}

function isNegativeChoiceOption(option: any): boolean {
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

function getChoiceSourceCardId(payload: any): string {
	const explicit = String(payload?.sourceCardId || "").trim();
	if (explicit) return explicit;
	const options = Array.isArray(payload?.options) ? payload.options : [];
	for (const option of options) {
		const candidate = String(option?.cardId || option?.label || "").trim();
		if (candidate && resolveCard(candidate)) return candidate;
	}
	return "";
}

function getChoiceOptionVisual(option: any, payload: any): { cardId: string; muted: boolean } {
	const explicit = String(option?.cardId || "").trim();
	if (explicit) return { cardId: explicit, muted: false };
	const labelCandidate = String(option?.label || "").trim();
	if (labelCandidate && resolveCard(labelCandidate)) {
		return { cardId: labelCandidate, muted: false };
	}
	const sourceCardId = getChoiceSourceCardId(payload);
	return { cardId: sourceCardId, muted: !!sourceCardId && isNegativeChoiceOption(option) };
}

function cardSubclassLine(card: CardDef | undefined): string {
	const parts = [String(card?.classe || "").trim(), String(card?.tipo || "").trim()].filter(Boolean);
	return parts.join(" • ");
}

function getSupportArrayForSide(side: BattleSide): string[] {
	return side === "you" ? currentMySupport : currentEnemySupport;
}

function getSupportAttachArrayForSide(side: BattleSide): number[] {
	return side === "you" ? currentMySupportAttach : currentEnemySupportAttach;
}

function getFieldAtkTempForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMyFieldAtkTemp : currentEnemyFieldAtkTemp;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) ? value : 0;
}

function getFieldAtkPermForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMyFieldAtkPerm : currentEnemyFieldAtkPerm;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) ? value : 0;
}

function getFieldAcPermForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMyFieldAcPerm : currentEnemyFieldAcPerm;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) ? value : 0;
}

function getFieldBlessingForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMyFieldBlessing : currentEnemyFieldBlessing;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function getLeaderBlessingForSide(side: BattleSide): number {
	return side === "you" ? currentMyLeaderBlessing : currentEnemyLeaderBlessing;
}

function getAttachedSupportNumericBonusForSide(side: BattleSide, targetPos: number | null, prop: string): number {
	const supports = getSupportArrayForSide(side);
	const attach = getSupportAttachArrayForSide(side);
	const expectedTarget = targetPos == null ? -1 : targetPos;
	let total = 0;
	for (let index = 0; index < supports.length; index += 1) {
		const supportCardId = String(supports[index] || "").trim();
		if (!supportCardId) continue;
		if (Number(attach[index] ?? -2) !== expectedTarget) continue;
		const supportDef = resolveCard(supportCardId) as any;
		const value = Number(supportDef?.[prop] || 0);
		if (Number.isFinite(value)) total += value;
	}
	return total;
}

function cardMatchesAuraTarget(cardId: string, auraTarget: any): boolean {
	if (!auraTarget) return false;
	const def = resolveCard(cardId) as any;
	if (!def) return false;
	if (auraTarget.classe) return normalizeKind(String(def?.classe || "")) === normalizeKind(String(auraTarget.classe || ""));
	if (auraTarget.tipo) return normalizeKind(String(def?.tipo || "")) === normalizeKind(String(auraTarget.tipo || ""));
	if (auraTarget.nameIncludes) return normalizeKind(String(def?.name || cardId || "")).includes(normalizeKind(String(auraTarget.nameIncludes || "")));
	return false;
}

function getAuraAttackBonusForSide(side: BattleSide, cardId: string): number {
	let total = 0;
	const field = side === "you" ? currentMyField : currentEnemyField;
	for (const sourceCardId of field) {
		const sourceDef = resolveCard(sourceCardId) as any;
		if (!sourceCardId || normalizeKind(String(sourceDef?.auraProp || "")) !== "atk") continue;
		if (!cardMatchesAuraTarget(cardId, sourceDef?.auraTarget)) continue;
		const value = Number(sourceDef?.effectValue ?? 1);
		total += Number.isFinite(value) ? value : 1;
	}
	return total;
}

function getAuraHpBonusForSide(side: BattleSide, cardId: string): number {
	let total = 0;
	const field = side === "you" ? currentMyField : currentEnemyField;
	for (const sourceCardId of field) {
		const sourceDef = resolveCard(sourceCardId) as any;
		if (!sourceCardId || String(sourceDef?.effect || "") !== "aura_hp") continue;
		if (!cardMatchesAuraTarget(cardId, sourceDef?.auraTarget)) continue;
		const value = Number(sourceDef?.effectValue ?? 1);
		total += Number.isFinite(value) ? value : 1;
	}
	return total;
}

function countMarcialCardsInBattle(): number {
	let total = 0;
	for (const cardId of [currentMyLeader, currentEnemyLeader]) if (cardId && cardHasFiliation(cardId, "Marcial")) total += 1;
	for (const source of [currentMyField, currentEnemyField, currentMySupport, currentEnemySupport]) {
		for (const cardId of source) if (cardId && cardHasFiliation(cardId, "Marcial")) total += 1;
	}
	for (const envId of [currentMyEnv, currentEnemyEnv]) if (envId && cardHasFiliation(envId, "Marcial")) total += 1;
	return total;
}

function isYohanCard(cardId: string): boolean {
	const card = resolveCard(cardId);
	const name = normalizeCardId(String(card?.name || cardId || ""));
	return name === normalizeCardId("Yohan, Ronin Vigilante")
		|| name === normalizeCardId("Yoran, Ronin Vigilante")
		|| cardEffectIds(cardId).includes("kornex_buff_per_marcial_in_play");
}

function getMarcialBattleBonus(cardId: string): number {
	if (!isYohanCard(cardId)) return 0;
	return Math.max(0, countMarcialCardsInBattle() - 1);
}

function isMarcialBonusEnvCard(cardId: string | null | undefined): boolean {
	const card = resolveCard(String(cardId || ""));
	if (String(card?.effect || "") === "marcial_bonus") return true;
	const normalized = normalizeCardId(String(card?.name || cardId || ""));
	return normalized === "camposensanguentados" || normalized === "campoensanguentado" || normalized === "camposbg";
}

function isMarcialCharacter(cardId: string): boolean {
	const card = resolveCard(cardId);
	const source = normalizeKind(String(card?.filiacao || ""));
	return source.includes(normalizeKind("Marcial"));
}

function hasMarcialEnvAttackBonusForSide(side: BattleSide, attackerId: string): boolean {
	if (!isMarcialBonusEnvCard(currentMyEnv) && !isMarcialBonusEnvCard(currentEnemyEnv)) return false;
	const leaderId = side === "you" ? currentMyLeader : currentEnemyLeader;
	return cardHasFiliation(leaderId, "Marcial") && isMarcialCharacter(attackerId);
}

function getCurrentLeaderHp(side: BattleSide): number {
	const value = side === "you" ? currentMyLeaderHp : currentEnemyLeaderHp;
	if (Number.isFinite(value) && value > 0) return value;
	const leaderId = side === "you" ? currentMyLeader : currentEnemyLeader;
	return Math.max(0, Number(resolveCard(leaderId)?.hp || 0));
}

function getLeaderAttackValue(side: BattleSide, cardId: string): number {
	let total = Number(resolveCard(cardId)?.atkBonus || 0);
	total += getAttachedSupportNumericBonusForSide(side, null, "atkBonus");
	total += getAttachedSupportNumericBonusForSide(side, null, "dmgBonus");
	if (hasMarcialEnvAttackBonusForSide(side, cardId)) total += 1;
	return Math.max(0, total);
}

function buildChoiceAttackerSummary(payload: any): string {
	const attackerId = String(payload?.attackerId || "").trim();
	const attackerName = String(payload?.attackerName || attackerId || "").trim();
	const currentAttack = Number(payload?.attackerAttack);
	if (!attackerName && !Number.isFinite(currentAttack)) return "";
	const lines: string[] = [];
	if (attackerName) lines.push(`Atacante: ${attackerName}`);
	if (Number.isFinite(currentAttack)) lines.push(`Ataque atual: ${currentAttack}`);
	const targetName = String(payload?.targetName || "").trim();
	if (targetName) lines.push(`Alvo atual: ${targetName}`);
	return lines.join("\n");
}

function getLeaderResistanceValue(side: BattleSide): number {
	return Math.max(0, getAttachedSupportNumericBonusForSide(side, null, "acBonus"));
}

function getLeaderEquipResistanceBonus(side: BattleSide): number {
	const equips = attachedEquipCards(side, null);
	let total = 0;
	for (const equipId of equips) {
		const equip = resolveCard(equipId) as any;
		const value = Number(equip?.acBonus || 0);
		if (Number.isFinite(value)) total += value;
	}
	return Math.max(0, total);
}

function getLeaderMaxHpValue(side: BattleSide, cardId: string): number {
	const baseHp = Number(resolveCard(cardId)?.hp || 20);
	return Math.max(1, baseHp + getAttachedSupportNumericBonusForSide(side, null, "hpBonus") + getLeaderBlessingForSide(side));
}

function getFieldAttackValue(side: BattleSide, index: number, cardId: string): number {
	let total = Number(resolveCard(cardId)?.atkBonus || 0);
	total += getFieldAtkTempForSide(side, index);
	total += getFieldAtkPermForSide(side, index);
	total += getAttachedSupportNumericBonusForSide(side, index, "atkBonus");
	total += getAttachedSupportNumericBonusForSide(side, index, "dmgBonus");
	total += getFieldVitalMarksForSide(side, index);
	total += getAuraAttackBonusForSide(side, cardId);
	total += getMarcialBattleBonus(cardId);
	if (hasMarcialEnvAttackBonusForSide(side, cardId)) total += 1;
	return Math.max(0, total);
}

function getFieldResistanceValue(side: BattleSide, index: number, cardId: string): number {
	const baseAc = Number(resolveCard(cardId)?.ac ?? 0);
	return Math.max(0, baseAc + getFieldAcPermForSide(side, index) + getAttachedSupportNumericBonusForSide(side, index, "acBonus"));
}

function getBaseAllyInspectorStats(card: CardDef | undefined): Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> {
	const baseHp = Number(card?.hp || 1);
	const baseAttack = Number(card?.atkBonus || card?.damage || 0);
	const baseResistance = Number(card?.ac || 0);
	return [
		{ label: "Vida", value: String(baseHp) },
		{ label: "Ataque", value: String(baseAttack) },
		{ label: "Resistência", value: String(baseResistance) }
	];
}

function formatStatWithDelta(total: number, base: number): string {
	const diff = total - base;
	if (diff === 0) return String(total);
	return `${total} (${diff > 0 ? "+" : ""}${diff})`;
}

function getFallbackFieldInspectorStats(view: InspectorView, card: CardDef | undefined): Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> {
	const hpValues = view.side === "you" ? currentMyFieldHp : currentEnemyFieldHp;
	const currentHp = Math.max(0, Number(hpValues[view.index || 0] ?? card?.hp ?? 1));
	const baseHp = Number(card?.hp || 1);
	const baseAttack = Number(card?.atkBonus || 0);
	const baseResistance = Number(card?.ac || 0);
	const marcialBonus = getMarcialBattleBonus(view.cardId);
	const attackValue = baseAttack + marcialBonus;
	const out: Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> = [
		{ label: "Vida", value: `${currentHp}/${baseHp}` },
		{ label: "Ataque", value: formatStatWithDelta(attackValue, baseAttack), tone: attackValue > baseAttack ? "good" : "neutral" },
		{ label: "Resistência", value: String(baseResistance) }
	];
	if (marcialBonus > 0) out.push({ label: "Bônus Marcial", value: `+${marcialBonus}`, tone: "gold" });
	return out;
}

function getYohanInspectorStats(view: InspectorView, card: CardDef): Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> {
	const index = typeof view.index === "number" ? view.index : 0;
	const hpValues = view.side === "you" ? currentMyFieldHp : currentEnemyFieldHp;
	const currentHp = Math.max(0, Number(hpValues[index] ?? card.hp ?? 1));
	const baseHp = Number(card.hp || 1);
	const baseAttack = Number(card.atkBonus || 0);
	const baseResistance = Number(card.ac || 0);
	const attack = getFieldAttackValue(view.side as BattleSide, index, view.cardId);
	const resistance = getFieldResistanceValue(view.side as BattleSide, index, view.cardId);
	const marcialBonus = getMarcialBattleBonus(view.cardId);
	const out: Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> = [
		{ label: "Vida", value: `${currentHp}/${baseHp}` },
		{ label: "Ataque", value: formatStatWithDelta(attack, baseAttack), tone: attack > baseAttack ? "good" : "neutral" },
		{ label: "Resistência", value: formatStatWithDelta(resistance, baseResistance), tone: resistance > baseResistance ? "good" : "neutral" }
	];
	if (marcialBonus > 0) out.push({ label: "Bônus Marcial", value: `+${marcialBonus}`, tone: "gold" });
	return out;
}

function getInspectorStats(view: InspectorView | null): Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> {
	if (!view?.cardId) return [];
	const card = resolveCard(view.cardId);
	if (!card) return [];
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
		if (card && isYohanCard(view.cardId)) return getYohanInspectorStats(view, card);
		const hpValues = view.side === "you" ? currentMyFieldHp : currentEnemyFieldHp;
		const currentHp = Math.max(0, Number(hpValues[view.index] ?? 0));
		const maxHp = getDisplayedFieldMaxHp(view.side, view.index, view.cardId);
		const attack = getFieldAttackValue(view.side, view.index, view.cardId);
		const resistance = getFieldResistanceValue(view.side, view.index, view.cardId);
		const baseAttack = Number(card.atkBonus || 0);
		const baseResistance = Number(card.ac || 0);
		const baseHp = Number(card.hp || 1);
		const marcialBonus = getMarcialBattleBonus(view.cardId);
		const hpValue = maxHp === baseHp ? `${currentHp}/${maxHp}` : `${currentHp}/${maxHp} (${maxHp > baseHp ? "+" : ""}${maxHp - baseHp})`;
		const out: Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> = [
			{ label: "Vida", value: hpValue, tone: currentHp < maxHp ? (currentHp / Math.max(1, maxHp) <= 0.5 ? "bad" : "neutral") : (maxHp > baseHp ? "good" : "neutral") },
			{ label: "Ataque", value: formatStatWithDelta(attack, baseAttack), tone: attack > baseAttack ? "good" : (attack < baseAttack ? "bad" : "neutral") },
			{ label: "Resistência", value: formatStatWithDelta(resistance, baseResistance), tone: resistance > baseResistance ? "good" : (resistance < baseResistance ? "bad" : "neutral") }
		];
		if (marcialBonus > 0) out.push({ label: "Bônus Marcial", value: `+${marcialBonus}`, tone: "gold" });
		return out;
	}
	if (view.lane === "support") {
		return [
			Number((card as any)?.hpBonus || 0) ? { label: "Vida", value: `+${Number((card as any)?.hpBonus || 0)}`, tone: "good" } : null,
			Number((card as any)?.atkBonus || 0) ? { label: "Ataque", value: `+${Number((card as any)?.atkBonus || 0)}`, tone: "good" } : null,
			Number((card as any)?.acBonus || 0) ? { label: "Resistência", value: `+${Number((card as any)?.acBonus || 0)}`, tone: "good" } : null,
			Number((card as any)?.dmgBonus || 0) ? { label: "Dano", value: `+${Number((card as any)?.dmgBonus || 0)}`, tone: "gold" } : null
		].filter(Boolean) as Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }>;
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

function getInspectorStatsSafe(view: InspectorView | null): Array<{ label: string; value: string; tone?: "good" | "bad" | "neutral" | "gold" }> {
	try {
		return getInspectorStats(view);
	} catch {
		const card = resolveCard(view?.cardId || "");
		if (view?.lane === "field" && view.side && typeof view.index === "number") return getFallbackFieldInspectorStats(view, card);
		if (getCardKind(view?.cardId || "") === "ally") return getBaseAllyInspectorStats(card);
		return [];
	}
}

function canSelectCombatTarget(target: BattleTarget): boolean {
	if (!isMyTurn || currentPhase !== "COMBAT" || selectedAttackerPos === null) return false;
	const runtime = getBattleRuntime();
	return canAttackTargetQuiet(runtime, { side: "you", idx: selectedAttackerPos }, target);
}

function cardPreviewDetails(cardId: string, card: CardDef | undefined, includeCost = true, includeFiliation = true, view: InspectorView | null = null): string {
	const headline = [
		card?.name || cardId,
		includeCost && typeof card?.cost === "number" ? `Custo ${card.cost}` : "",
		includeFiliation && card?.filiacao ? `Filiação ${card.filiacao}` : ""
	].filter(Boolean).join(" • ");
	const subclass = cardSubclassLine(card);
	const text = String(card?.text || "").trim();
	return [headline, subclass, text].filter(Boolean).join("\n");
}

function previewFiliationLine(card: CardDef | undefined): string {
	const parts = [String(card?.filiacao || "").trim(), typeof card?.cost === "number" ? `Custo ${card.cost}` : ""].filter(Boolean);
	return parts.join(" • ");
}

function previewTextLine(cardId: string, card: CardDef | undefined): string {
	const text = String(card?.text || "").trim();
	return text || String(card?.description || "").trim() || String(card?.tipo || cardId || "").trim();
}

function asAssetPath(path: string | undefined): string {
	if (!path) return "";
	if (/^(https?:|data:|file:|\/\/)/i.test(path)) return path;
	if (path.startsWith("/")) return path;
	let normalized = String(path).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\.\.\//, "");
	if (normalized.startsWith("assets/")) normalized = normalized.slice("assets/".length);
	return `/${normalized}`;
}

function cardKeywords(cardId: string): string[] {
	const card = resolveCard(cardId);
	const text = String(card?.text || "").toLowerCase();
	const keywords: string[] = [];
	const rawKeywords = Array.isArray((card as any)?.keywords) ? ((card as any).keywords as unknown[]).map((kw) => String(kw || "").toLowerCase()) : [];
	if (rawKeywords.includes("investida") || text.includes("investida")) keywords.push("investida");
	if (rawKeywords.includes("provocar") || text.includes("provocar") || text.includes("desafio")) keywords.push("provocar");
	if (rawKeywords.includes("bloquear") || text.includes("bloquear") || text.includes("interpor")) keywords.push("bloquear");
	if (text.includes("precis") || text.includes("precisão")) keywords.push("precisao");
	if (rawKeywords.includes("atropelar") || text.includes("atropelar")) keywords.push("atropelar");
	return keywords;
}

function cardEffectIds(cardId: string): string[] {
	const card = resolveCard(cardId);
	const raw = [card?.effect, (card as any)?.effectA, (card as any)?.effectB];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const effectId = String(value || "").trim();
		if (!effectId || seen.has(effectId)) continue;
		seen.add(effectId);
		out.push(effectId);
	}
	return out;
}

function leaderHasEffect(cardId: string, effectId: string): boolean {
	return cardEffectIds(cardId).includes(String(effectId || "").trim());
}

function hasManualLeaderPower(cardId: string): boolean {
	return leaderHasEffect(cardId, "valbrak_citizen_boost")
		|| leaderHasEffect(cardId, "ademais_spider_burst")
		|| leaderHasEffect(cardId, "leafae_vital_guard");
}

function canUseLeaderPower(): boolean {
	if (!room || !isMyTurn || currentPhase !== "PREP" || currentMyLeaderTapped) return false;
	if (leaderHasEffect(currentMyLeader, "valbrak_citizen_boost")) return currentMyFragments >= 2;
	if (leaderHasEffect(currentMyLeader, "ademais_spider_burst")) return currentMyLeaderSpiderMarks >= 4;
	if (leaderHasEffect(currentMyLeader, "leafae_vital_guard")) return currentMyLeaderVitalMarks >= 3;
	return false;
}

function toBattleCard(cardId: string, side: BattleSide, index: number): BattleCard | null {
	const cleanId = String(cardId || "").trim();
	if (!cleanId) return null;
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

function getBattleRuntime(): BattleRuntime {
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
				if (selectedAttackerPos === null) view.selectedAttackerEl.textContent = "—";
				else view.selectedAttackerEl.textContent = `[${selectedAttackerPos}] ${currentMyField[selectedAttackerPos] || "—"}`;
			}
		},
		onAttackResolved: (selection: AttackSelection, target: BattleTarget) => {
			if (!room) return;
			if (selection.side !== "you") return;
			if (selection.leader) return;
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

function beginBoardAttackFrom(index: number): void {
	if (!isMyTurn || currentPhase !== "COMBAT") return;
	const runtime = getBattleRuntime();
	const card = runtime.state.you.allies[index] ?? null;
	if (selectedAttackerPos === index) {
		resetBoardAttackSelection();
		cancelBoardAttackSelection();
		return;
	}
	if (!canAttackCardQuiet(runtime, "you", card)) {
		resetBoardAttackSelection();
		cancelBoardAttackSelection();
		return;
	}
	selectedAttackerPos = index;
	selectedTargetType = "leader";
	selectedTargetPos = null;
	startAttackArrow(document.getElementById(`you-ally-${index}`));
	if (view.selectedAttackerEl) view.selectedAttackerEl.textContent = `[${index}] ${currentMyField[index] || "—"}`;
	if (view.selectedTargetEl) view.selectedTargetEl.textContent = "Líder inimigo";
	rerenderCombatSelectionState();
	selectAttacker(runtime, "you", index);
	if (!document.querySelector(".slot.clickable")) {
		resetBoardAttackSelection();
		cancelBoardAttackSelection();
	}
}

function canSelectCombatAttacker(index: number): boolean {
	if (!isMyTurn || currentPhase !== "COMBAT") return false;
	if (selectedAttackerPos === index) return true;
	const runtime = getBattleRuntime();
	const card = runtime.state.you.allies[index] ?? null;
	return canAttackCardQuiet(runtime, "you", card);
}

function rerenderCombatSelectionState(): void {
	renderMyField(currentMyField, currentMyFieldHp);
	renderEnemyField(currentEnemyField, currentEnemyFieldHp);
	renderLeaderSlot("you-leader", currentMyLeader, currentMyLeaderHp);
	renderLeaderSlot("ai-leader", currentEnemyLeader, currentEnemyLeaderHp);
	syncEnemyLeaderCombatTargetState();
}

function syncEnemyLeaderCombatTargetState(): void {
	const enemyLeaderSlot = document.getElementById("ai-leader");
	if (!enemyLeaderSlot) return;
	enemyLeaderSlot.classList.toggle("combat-target", canSelectCombatTarget({ type: "leader", side: "ai" }));
	clearAttackTargetHover(enemyLeaderSlot as HTMLElement);
	enemyLeaderSlot.onclick = () => {
		if (!canSelectCombatTarget({ type: "leader", side: "ai" })) return;
		resolveSelectedBoardAttack({ type: "leader", side: "ai" });
	};
	if (canSelectCombatTarget({ type: "leader", side: "ai" })) {
		(enemyLeaderSlot as HTMLElement & { __attackHoverCleanup?: (() => void) | null }).__attackHoverCleanup = bindAttackTargetHover(enemyLeaderSlot);
	}
}

function cancelBoardAttackSelection(): void {
	stopAttackArrow();
	endAttackCleanup(getBattleRuntime());
}

function resetBoardAttackSelection(): void {
	stopAttackArrow();
	selectedAttackerPos = null;
	selectedTargetType = "leader";
	selectedTargetPos = null;
	if (view.selectedAttackerEl) view.selectedAttackerEl.textContent = "—";
	if (view.selectedTargetEl) view.selectedTargetEl.textContent = "Líder inimigo";
	rerenderCombatSelectionState();
}

function resolveSelectedBoardAttack(target: BattleTarget): void {
	const runtime = getBattleRuntime();
	if (selectedAttackerPos !== null) {
		selectAttacker(runtime, "you", selectedAttackerPos);
	}
	resolveAttackOn(runtime, target);
	stopAttackArrow();
	resetBoardAttackSelection();
}

function sameInspectorView(a: InspectorView | null, b: InspectorView | null): boolean {
	return a?.cardId === b?.cardId && a?.side === b?.side && a?.lane === b?.lane && a?.index === b?.index;
}

function normalizedInspectorView(viewState: InspectorView | null): InspectorView | null {
	if (!viewState?.cardId || !String(viewState.cardId).trim()) return null;
	return {
		cardId: String(viewState.cardId).trim(),
		side: viewState.side,
		lane: viewState.lane,
		index: typeof viewState.index === "number" ? viewState.index : undefined
	};
}

function renderInspector(target: string | InspectorView | null): void {
	const img = document.getElementById("bigImg") as HTMLImageElement | null;
	const meta = document.getElementById("bigMeta");
	const stats = document.getElementById("bigStats");
	const titleEl = document.getElementById("bigMetaTitle");
	const filiationEl = document.getElementById("bigMetaFiliation");
	const subclassEl = document.getElementById("bigMetaSubclass");
	const textEl = document.getElementById("bigMetaText");
	if (!img || !meta || !stats || !titleEl || !filiationEl || !subclassEl || !textEl) return;
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
	img.src = asAssetPath(card?.img);
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
	textEl.textContent = previewTextLine(nextView.cardId, card);
}

function setInspector(target: string | InspectorView | null): void {
	const nextView = normalizedInspectorView(typeof target === "string" ? { cardId: target } : target);
	selectedInspectorView = nextView;
	selectedHandCardId = nextView?.lane === "hand" ? nextView.cardId : (nextView?.cardId || selectedHandCardId);
	renderInspector(nextView);
}


function setHoveredInspector(target: string | InspectorView | null): void {
	hoveredInspectorView = normalizedInspectorView(typeof target === "string" ? { cardId: target } : target);
	const fallback = hoveredInspectorView || selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId } : null);
	renderInspector(fallback);
}

function buildHandCard(cardId: string, selected: boolean, onClick?: () => void, inspectorView?: InspectorView | null): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "card handCard slotCard";
	button.style.cursor = onClick ? "pointer" : "default";
	button.style.padding = "0";
	button.draggable = !!onClick;
	button.dataset.cardId = cardId;
	button.dataset.cardKind = getCardKind(cardId);
	if (selected) button.classList.add("is-selected");

	const card = resolveCard(cardId);
	if (card?.img) {
		const image = document.createElement("img");
		image.src = asAssetPath(card.img);
		image.alt = card.name || cardId;
		image.className = "slotCardImg";
		button.appendChild(image);
	} else {
		const fallback = document.createElement("div");
		fallback.className = "slotCardFallback";
		fallback.textContent = cardId;
		button.appendChild(fallback);
	}
	if (inspectorView?.lane === "hand") appendCostBadge(button, card?.cost);

	button.onmouseenter = () => setHoveredInspector(inspectorView || cardId);
	button.onfocus = () => setHoveredInspector(inspectorView || cardId);
	button.onmouseleave = () => setHoveredInspector(null);
	button.onblur = () => setHoveredInspector(null);
	button.ondragstart = (event) => {
		if (!event.dataTransfer || !isMyTurn || currentPhase !== "PREP") return;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", cardId);
		event.dataTransfer.setData("application/x-card-kind", getCardKind(cardId));
	};
	if (onClick) button.onclick = onClick;
	return button;
}

function buildBackCard(cardId?: string): HTMLDivElement {
	const back = document.createElement("div");
	back.className = "card handCard slotCard slotCardBack";
	if (cardId) back.dataset.cardId = cardId;
	const image = document.createElement("img");
	image.className = "slotCardImg";
	image.src = asAssetPath(CARD_BACK_ASSET);
	image.alt = "Carta";
	image.onerror = () => {
		back.textContent = "Carta";
	};
	back.appendChild(image);
	return back;
}

function getNewHandEntryFlags(nextCards: string[], previousCards: string[]): boolean[] {
	const previousCounts = new Map<string, number>();
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

function listRemovedCards(previousCards: string[], nextCards: string[]): string[] {
	const nextCounts = new Map<string, number>();
	for (const cardId of nextCards) nextCounts.set(cardId, (nextCounts.get(cardId) || 0) + 1);
	const removed: string[] = [];
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

function listAddedCards(previousCards: string[], nextCards: string[]): string[] {
	const previousCounts = new Map<string, number>();
	for (const cardId of previousCards) previousCounts.set(cardId, (previousCounts.get(cardId) || 0) + 1);
	const added: string[] = [];
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

function captureHandTransferSnapshots(containerId: "youHand" | "aiHand"): Map<string, HandTransferSnapshot[]> {
	const container = document.getElementById(containerId);
	const snapshots = new Map<string, HandTransferSnapshot[]>();
	if (!container) return snapshots;
	for (const node of Array.from(container.querySelectorAll(":scope > [data-card-id]"))) {
		const el = node as HTMLElement;
		const cardId = String(el.dataset.cardId || "").trim();
		if (!cardId) continue;
		const image = el.querySelector("img") as HTMLImageElement | null;
		const entry: HandTransferSnapshot = {
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

function takeHandTransferSnapshot(snapshots: Map<string, HandTransferSnapshot[]>, cardId: string): HandTransferSnapshot | null {
	const bucket = snapshots.get(cardId);
	if (!bucket?.length) return null;
	const snapshot = bucket.shift() || null;
	if (!bucket.length) snapshots.delete(cardId);
	return snapshot;
}

function consumeRemovedHandCard(removedCounts: Map<string, number>, cardId: string): boolean {
	const remaining = removedCounts.get(cardId) || 0;
	if (remaining <= 0) return false;
	if (remaining === 1) removedCounts.delete(cardId);
	else removedCounts.set(cardId, remaining - 1);
	return true;
}

function animateHandTransferFromSnapshot(snapshots: Map<string, HandTransferSnapshot[]>, cardId: string, targetEl: Element | null): void {
	const snapshot = takeHandTransferSnapshot(snapshots, cardId);
	if (!snapshot || !targetEl) return;
	animateCardTransfer(snapshot.originRect, targetEl, { imageSrc: snapshot.imageSrc, fadeOut: false, durationMs: 280 });
}

function takeAnyHandTransferSnapshot(snapshots: Map<string, HandTransferSnapshot[]>): HandTransferSnapshot | null {
	for (const [cardId, bucket] of snapshots) {
		if (!bucket.length) continue;
		const snapshot = bucket.shift() || null;
		if (!bucket.length) snapshots.delete(cardId);
		return snapshot;
	}
	return null;
}

function animateAnyHandTransferFromSnapshot(snapshots: Map<string, HandTransferSnapshot[]>, targetEl: Element | null): void {
	const snapshot = takeAnyHandTransferSnapshot(snapshots);
	if (!snapshot || !targetEl) return;
	animateCardTransfer(snapshot.originRect, targetEl, { imageSrc: snapshot.imageSrc, fadeOut: false, durationMs: 280 });
}

function animateVisibleHandTransfers(
	snapshots: Map<string, HandTransferSnapshot[]>,
	prefix: "you" | "ai",
	previousHand: string[],
	nextHand: string[],
	previousField: string[],
	nextField: string[],
	previousSupport: string[],
	nextSupport: string[],
	previousEnv: string | null,
	nextEnv: string | null,
	previousGrave: string[],
	nextGrave: string[],
	previousBanished: string[],
	nextBanished: string[]
): void {
	if (!previousHand.length) return;
	const removedCounts = new Map<string, number>();
	for (const cardId of listRemovedCards(previousHand, nextHand)) {
		removedCounts.set(cardId, (removedCounts.get(cardId) || 0) + 1);
	}
	if (!removedCounts.size) return;

	for (let index = 0; index < nextField.length; index += 1) {
		const cardId = String(nextField[index] || "").trim();
		if (!cardId || previousField[index] === cardId || !consumeRemovedHandCard(removedCounts, cardId)) continue;
		animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-ally-${index} > .card`));
	}
	for (let index = 0; index < nextSupport.length; index += 1) {
		const cardId = String(nextSupport[index] || "").trim();
		if (!cardId || previousSupport[index] === cardId || !consumeRemovedHandCard(removedCounts, cardId)) continue;
		animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-support-${index} > .card`));
	}
	if (nextEnv && nextEnv !== previousEnv && consumeRemovedHandCard(removedCounts, nextEnv)) {
		animateHandTransferFromSnapshot(snapshots, nextEnv, document.querySelector(`#${prefix}-env > .card`));
	}
	for (const cardId of listAddedCards(previousGrave, nextGrave)) {
		if (!consumeRemovedHandCard(removedCounts, cardId)) continue;
		animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-grave > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-grave`));
	}
	for (const cardId of listAddedCards(previousBanished, nextBanished)) {
		if (!consumeRemovedHandCard(removedCounts, cardId)) continue;
		animateHandTransferFromSnapshot(snapshots, cardId, document.querySelector(`#${prefix}-banished > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-banished`));
	}
}

function animateHiddenHandTransfers(
	snapshots: Map<string, HandTransferSnapshot[]>,
	prefix: "you" | "ai",
	previousHand: string[],
	nextHand: string[],
	previousField: string[],
	nextField: string[],
	previousSupport: string[],
	nextSupport: string[],
	previousEnv: string | null,
	nextEnv: string | null,
	previousGrave: string[],
	nextGrave: string[],
	previousBanished: string[],
	nextBanished: string[]
): void {
	let flightsRemaining = Math.max(0, previousHand.length - nextHand.length);
	if (!flightsRemaining) return;
	const tryAnimate = (targetEl: Element | null) => {
		if (flightsRemaining <= 0) return;
		animateAnyHandTransferFromSnapshot(snapshots, targetEl);
		flightsRemaining -= 1;
	};
	for (let index = 0; index < nextField.length; index += 1) {
		if (!nextField[index] || previousField[index] === nextField[index]) continue;
		tryAnimate(document.querySelector(`#${prefix}-ally-${index} > .card`));
	}
	for (let index = 0; index < nextSupport.length; index += 1) {
		if (!nextSupport[index] || previousSupport[index] === nextSupport[index]) continue;
		tryAnimate(document.querySelector(`#${prefix}-support-${index} > .card`));
	}
	if (nextEnv && nextEnv !== previousEnv) tryAnimate(document.querySelector(`#${prefix}-env > .card`));
	for (let index = 0; index < listAddedCards(previousGrave, nextGrave).length; index += 1) {
		tryAnimate(document.querySelector(`#${prefix}-grave > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-grave`));
	}
	for (let index = 0; index < listAddedCards(previousBanished, nextBanished).length; index += 1) {
		tryAnimate(document.querySelector(`#${prefix}-banished > .deckVisualCard:last-of-type`) || document.getElementById(`${prefix}-banished`));
	}
}

function queueLanePileFlights(zoneId: "you-field" | "ai-field" | "you-support" | "ai-support", cardIds: string[]): void {
	const queue = pendingLanePileFlights[zoneId];
	queue.clear();
	for (const cardId of cardIds) {
		if (!cardId) continue;
		queue.set(cardId, (queue.get(cardId) || 0) + 1);
	}
}

function consumeLanePileFlight(zoneId: "you-field" | "ai-field" | "you-support" | "ai-support", cardId: string): boolean {
	const queue = pendingLanePileFlights[zoneId];
	const remaining = queue.get(cardId) || 0;
	if (remaining <= 0) return false;
	if (remaining === 1) queue.delete(cardId);
	else queue.set(cardId, remaining - 1);
	return true;
}

function captureLaneTransferSnapshots(zoneIds: Array<"you-field" | "ai-field" | "you-support" | "ai-support">): Map<string, LaneTransferSnapshot[]> {
	const snapshots = new Map<string, LaneTransferSnapshot[]>();
	for (const zoneId of zoneIds) {
		const zone = document.getElementById(zoneId);
		if (!zone) continue;
		for (const slot of Array.from(zone.children)) {
			const cardEl = (slot as HTMLElement).querySelector(":scope > .card") as HTMLElement | null;
			if (!cardEl) continue;
			const cardId = String(cardEl.dataset.cardId || "").trim();
			if (!cardId) continue;
			const image = cardEl.querySelector("img") as HTMLImageElement | null;
			const entry: LaneTransferSnapshot = {
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

function takeLaneTransferSnapshot(snapshots: Map<string, LaneTransferSnapshot[]>, preferredZoneId: "you-field" | "ai-field" | "you-support" | "ai-support", cardId: string): LaneTransferSnapshot | null {
	const bucket = snapshots.get(cardId);
	if (!bucket?.length) return null;
	const preferredIndex = bucket.findIndex((entry) => entry.zoneId === preferredZoneId);
	const index = preferredIndex >= 0 ? preferredIndex : 0;
	const [snapshot] = bucket.splice(index, 1);
	if (!bucket.length) snapshots.delete(cardId);
	return snapshot || null;
}

function animateBoardPileTransferFromSnapshot(
	snapshots: Map<string, LaneTransferSnapshot[]>,
	preferredZoneId: "you-field" | "ai-field" | "you-support" | "ai-support",
	cardId: string,
	targetEl: Element | null
): void {
	const snapshot = takeLaneTransferSnapshot(snapshots, preferredZoneId, cardId);
	if (!snapshot || !targetEl) return;
	animateCardTransfer(snapshot.originRect, targetEl, { imageSrc: snapshot.imageSrc, fadeOut: false, durationMs: 300 });
}

function animateBoardPileTransfers(
	snapshots: Map<string, LaneTransferSnapshot[]>,
	fieldZoneId: "you-field" | "ai-field",
	supportZoneId: "you-support" | "ai-support",
	previousField: string[],
	nextField: string[],
	previousSupport: string[],
	nextSupport: string[],
	previousGrave: string[],
	nextGrave: string[],
	previousBanished: string[],
	nextBanished: string[],
	graveTargetEl: Element | null,
	banishedTargetEl: Element | null
): void {
	const removedField = listRemovedCards(previousField, nextField);
	const removedSupport = listRemovedCards(previousSupport, nextSupport);
	if (!removedField.length && !removedSupport.length) return;
	const removedFieldCounts = new Map<string, number>();
	for (const cardId of removedField) removedFieldCounts.set(cardId, (removedFieldCounts.get(cardId) || 0) + 1);
	const removedSupportCounts = new Map<string, number>();
	for (const cardId of removedSupport) removedSupportCounts.set(cardId, (removedSupportCounts.get(cardId) || 0) + 1);

	const playTransfer = (cardId: string, targetEl: Element | null) => {
		if (consumeRemovedHandCard(removedFieldCounts, cardId)) {
			animateBoardPileTransferFromSnapshot(snapshots, fieldZoneId, cardId, targetEl);
			return;
		}
		if (consumeRemovedHandCard(removedSupportCounts, cardId)) {
			animateBoardPileTransferFromSnapshot(snapshots, supportZoneId, cardId, targetEl);
		}
	};

	for (const cardId of listAddedCards(previousGrave, nextGrave)) playTransfer(cardId, graveTargetEl);
	for (const cardId of listAddedCards(previousBanished, nextBanished)) playTransfer(cardId, banishedTargetEl);
}

function getBoardCardsMovingToPiles(
	previousField: string[],
	nextField: string[],
	previousSupport: string[],
	nextSupport: string[],
	previousGrave: string[],
	nextGrave: string[],
	previousBanished: string[],
	nextBanished: string[]
): { field: string[]; support: string[] } {
	const fieldCounts = new Map<string, number>();
	for (const cardId of listRemovedCards(previousField, nextField)) fieldCounts.set(cardId, (fieldCounts.get(cardId) || 0) + 1);
	const supportCounts = new Map<string, number>();
	for (const cardId of listRemovedCards(previousSupport, nextSupport)) supportCounts.set(cardId, (supportCounts.get(cardId) || 0) + 1);
	const field: string[] = [];
	const support: string[] = [];
	const addedToPiles = [
		...listAddedCards(previousGrave, nextGrave),
		...listAddedCards(previousBanished, nextBanished)
	];
	for (const cardId of addedToPiles) {
		if (consumeRemovedHandCard(fieldCounts, cardId)) {
			field.push(cardId);
			continue;
		}
		if (consumeRemovedHandCard(supportCounts, cardId)) support.push(cardId);
	}
	return { field, support };
}

function pileCards(side: BattleSide, which: "deck" | "grave" | "banished"): string[] {
	if (side === "you") {
		if (which === "deck") return currentMyDeck;
		if (which === "grave") return currentMyGrave;
		return currentMyBanished;
	}
	if (which === "deck") return currentEnemyDeck;
	if (which === "grave") return currentEnemyGrave;
	return currentEnemyBanished;
}

function attachedEquipCards(side: BattleSide, targetPos: number | null): string[] {
	const supports = side === "you" ? currentMySupport : currentEnemySupport;
	const supportAttach = side === "you" ? currentMySupportAttach : currentEnemySupportAttach;
	const expectedTarget = targetPos == null ? -1 : targetPos;
	const out: string[] = [];
	for (let index = 0; index < supports.length; index += 1) {
		const supportCardId = String(supports[index] || "").trim();
		if (!supportCardId) continue;
		if (Number(supportAttach[index] ?? -2) !== expectedTarget) continue;
		if (getCardKind(supportCardId) !== "equip") continue;
		out.push(supportCardId);
	}
	return out;
}

function appendEquipAttachTag(cardEl: HTMLElement, side: BattleSide, targetPos: number | null): void {
	const equips = attachedEquipCards(side, targetPos);
	if (!equips.length) return;
	const tag = document.createElement("div");
	tag.className = "equipAttachTag";
	tag.textContent = `⚙${equips.length}`;
	tag.title = `Equipado por: ${equips.join(", ")}`;
	cardEl.appendChild(tag);
}

function getSupportCounterForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMySupportCounters : currentEnemySupportCounters;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function appendSupportCounterTag(cardEl: HTMLElement, value: number): void {
	if (!Number.isFinite(value) || value <= 0) return;
	const tag = document.createElement("div");
	tag.className = "equipAttachTag";
	tag.textContent = `✦${value}`;
	tag.title = `Cartas deslocadas por este efeito: ${value}`;
	cardEl.appendChild(tag);
}

function appendAllyStatsBar(cardEl: HTMLElement, values: { hp: number; maxHp: number; attack: number; resistance: number }): void {
	const bar = document.createElement("div");
	bar.className = "allyStatsRow";
	const hpTag = document.createElement("div");
	hpTag.className = "allyStatTag allyStatTag--hp";
	if (values.maxHp > 0 && values.hp / values.maxHp <= 0.5) hpTag.classList.add("low");
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

function appendChosenStatsBar(cardEl: HTMLElement, values: { hp: number; maxHp: number; resistance: number }): void {
	const bar = document.createElement("div");
	bar.className = "allyStatsRow chosenStatsRow";

	const hpTag = document.createElement("div");
	hpTag.className = "allyStatTag allyStatTag--hp";
	if (values.maxHp > 0 && values.hp / values.maxHp <= 0.5) hpTag.classList.add("low");
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
		bar.classList.add("chosenStatsRow--dual");
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
	} else {
		bar.classList.add("chosenStatsRow--single");
	}

	cardEl.appendChild(bar);
}

function pileLabel(which: "deck" | "grave" | "banished"): string {
	if (which === "deck") return "Deck";
	if (which === "grave") return "Cemitério";
	return "Deslocadas";
}

function renderPileModal(): void {
	const modal = document.getElementById("pileModal") as HTMLElement | null;
	const title = document.getElementById("pileTitle");
	const grid = document.getElementById("pileGrid") as HTMLElement | null;
	if (!modal || !title || !grid) return;
	const sideLabel = activePileSide === "you" ? "Você" : "Oponente";
	title.textContent = `${sideLabel} • ${pileLabel(activePileWhich)}`;
	grid.innerHTML = "";
	grid.style.display = "grid";
	grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(63px, 1fr))";
	grid.style.gap = "8px";

	const box = modal.querySelector(".modalBox") as HTMLElement | null;
	if (!box) return;
	let tabs = box.querySelector("#pileTabs") as HTMLElement | null;
	if (!tabs) {
		tabs = document.createElement("div");
		tabs.id = "pileTabs";
		tabs.style.display = "flex";
		tabs.style.gap = "8px";
		tabs.style.margin = "0 0 10px 0";
		const header = title.parentElement;
		if (header && header.nextElementSibling) box.insertBefore(tabs, header.nextElementSibling);
		else box.appendChild(tabs);
	}
	tabs.innerHTML = "";
	for (const which of ["deck", "grave", "banished"] as const) {
		const tab = document.createElement("button");
		tab.type = "button";
		tab.className = "btn";
		tab.textContent = pileLabel(which);
		if (which === activePileWhich) tab.classList.add("primary");
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
		if (!cardId) continue;
		const card = resolveCard(cardId);
		const hideFace = activePileWhich === "deck" && activePileSide === "ai";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "card slotCard";
		button.style.width = "63px";
		button.style.height = "88px";
		button.style.cursor = "default";
		const image = document.createElement("img");
		image.className = "slotCardImg";
		image.src = hideFace ? asAssetPath(CARD_BACK_ASSET) : asAssetPath(card?.img || CARD_BACK_ASSET);
		image.alt = hideFace ? "Carta virada" : (card?.name || cardId);
		image.onerror = () => {
			image.src = asAssetPath(CARD_BACK_ASSET);
		};
		button.appendChild(image);
		button.onmouseenter = () => {
			if (hideFace) return;
			setHoveredInspector({ cardId, side: activePileSide, lane: activePileWhich });
		};
		button.onmouseleave = () => setHoveredInspector(null);
		grid.appendChild(button);
	}
}

function renderVisiblePileSlot(slotId: string, countId: string, cards: string[], hideFace: boolean): void {
	const slotEl = document.getElementById(slotId);
	const countEl = document.getElementById(countId);
	if (countEl) countEl.textContent = String(cards.length);
	if (!slotEl) return;
	for (const old of Array.from(slotEl.querySelectorAll(":scope > .deckVisualCard"))) old.remove();
	if (!cards.length) return;
	const topCardId = String(cards[cards.length - 1] || "").trim();
	const topCard = resolveCard(topCardId);
	for (let layer = 0; layer < Math.min(3, cards.length); layer += 1) {
		const cardEl = document.createElement("div");
		cardEl.className = "card slotCard deckVisualCard";
		cardEl.style.width = "100%";
		cardEl.style.height = "100%";
		cardEl.style.margin = "0";
		cardEl.style.position = "absolute";
		cardEl.style.left = `${layer * 2}px`;
		cardEl.style.top = `${layer * 2}px`;
		cardEl.style.zIndex = String(10 + layer);
		const image = document.createElement("img");
		image.className = "slotCardImg";
		image.src = hideFace ? asAssetPath(CARD_BACK_ASSET) : asAssetPath(topCard?.img || CARD_BACK_ASSET);
		image.alt = hideFace ? "Carta virada" : (topCard?.name || topCardId || "Carta");
		image.onerror = () => {
			image.src = asAssetPath(CARD_BACK_ASSET);
		};
		cardEl.appendChild(image);
		if (layer === Math.min(3, cards.length) - 1 && !hideFace) {
			const side = slotId.startsWith("you") ? "you" : "ai";
			const lane: InspectorLane = slotId.includes("grave") ? "grave" : (slotId.includes("ban") ? "banished" : "deck");
			cardEl.onmouseenter = () => setHoveredInspector({ cardId: topCardId, side, lane });
			cardEl.onmouseleave = () => setHoveredInspector(null);
		}
		slotEl.appendChild(cardEl);
	}
}

function showPile(side: BattleSide, which: "deck" | "grave" | "banished"): void {
	activePileSide = side;
	activePileWhich = which;
	const modal = document.getElementById("pileModal") as HTMLElement | null;
	if (!modal) return;
	modal.style.display = "flex";
	renderPileModal();
}

function hidePile(): void {
	const modal = document.getElementById("pileModal") as HTMLElement | null;
	if (!modal) return;
	modal.style.display = "none";
}

function bindPileSlots(): void {
	for (const side of ["you", "ai"] as const) {
		const deckSlot = document.getElementById(`${side}-deck`);
		const graveSlot = document.getElementById(`${side}-grave`);
		const banSlot = document.getElementById(`${side}-banished`) || document.getElementById(`${side}-ban`);
		if (deckSlot) deckSlot.onclick = () => showPile(side, "deck");
		if (graveSlot) graveSlot.onclick = () => showPile(side, "grave");
		if (banSlot) banSlot.onclick = () => showPile(side, "banished");
	}
}

function hideCardChoiceModal(sendCancel: boolean = true) {
	const modal = document.getElementById("cardChoiceModal") as HTMLElement | null;
	if (!modal) return;
	modal.style.display = "none";
	if (activeChoiceTimer) {
		window.clearInterval(activeChoiceTimer);
		activeChoiceTimer = null;
	}
	const countdown = document.getElementById("cardChoiceCountdown") as HTMLElement | null;
	if (countdown) {
		countdown.style.display = "none";
		countdown.classList.remove("is-danger");
	}
	const grid = document.getElementById("cardChoiceGrid");
	if (grid) grid.innerHTML = "";
	if (sendCancel && room && activeChoiceId) {
		room.send("effect_choice_submit", { choiceId: activeChoiceId, optionId: null });
	}
	activeChoiceId = null;
}

function startCountdown(containerId: string, valueId: string, timeoutMs: number, store: "choice" | "waiting") {
	const container = document.getElementById(containerId) as HTMLElement | null;
	const valueEl = document.getElementById(valueId) as HTMLElement | null;
	if (!container || !valueEl || timeoutMs <= 0) return;
	container.style.display = "block";
	const endAt = Date.now() + timeoutMs;
	const render = () => {
		const remainingMs = Math.max(0, endAt - Date.now());
		const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
		valueEl.textContent = String(remaining);
		container.classList.toggle("is-danger", remaining <= 5);
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
		if (activeChoiceTimer) window.clearInterval(activeChoiceTimer);
		activeChoiceTimer = intervalId;
	} else {
		if (activeWaitingTimer) window.clearInterval(activeWaitingTimer);
		activeWaitingTimer = intervalId;
	}
}

function showChoiceWaitingModal(payload: any) {
	const modal = document.getElementById("choiceWaitingModal") as HTMLElement | null;
	const title = document.getElementById("choiceWaitingTitle");
	const text = document.getElementById("choiceWaitingText");
	if (!modal || !title || !text) return;
	title.textContent = "Seu oponente está escolhendo";
	const shouldReveal = (typeof isSpectator !== "undefined" && isSpectator) || payload?.reveal === true;
	text.textContent = shouldReveal
		? String(payload?.title || "Aguarde a decisão para a partida continuar.")
		: "Aguarde a decisão para a partida continuar.";
	modal.style.display = "flex";
	startCountdown("choiceWaitingCountdown", "choiceWaitingCountdownValue", Number(payload?.timeoutMs || 0), "waiting");
}

function createChoiceDuelPanel(payload: any): HTMLElement | null {
	const attackerId = String(payload?.attackerId || "").trim();
	const targetCardId = String(payload?.targetCardId || "").trim();
	const attackerName = String(payload?.attackerName || attackerId || "Atacante").trim();
	const targetName = String(payload?.targetName || targetCardId || "Alvo").trim();
	const attackerAttack = Number(payload?.attackerAttack);
	const targetResistance = Number(payload?.targetResistance);
	const targetHp = Number(payload?.targetHp);
	const targetMaxHp = Number(payload?.targetMaxHp);
	if (!attackerId && !targetCardId) return null;

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

	const buildMini = (cardId: string, name: string, tone: "atk" | "def") => {
		const wrap = document.createElement("div");
		wrap.style.display = "grid";
		wrap.style.gap = "4px";
		wrap.style.justifyItems = "center";
		const card = resolveCard(cardId);
		const thumb = document.createElement("img");
		thumb.src = asAssetPath(card?.img || CARD_BACK_ASSET);
		thumb.alt = name || cardId || (tone === "atk" ? "Atacante" : "Alvo");
		thumb.style.width = "72px";
		thumb.style.height = "100px";
		thumb.style.objectFit = "cover";
		thumb.style.borderRadius = "8px";
		thumb.style.border = tone === "atk"
			? "1px solid rgba(248,113,113,.55)"
			: "1px solid rgba(125,211,252,.55)";
		thumb.style.boxShadow = "0 6px 14px rgba(0,0,0,.35)";
		thumb.onerror = () => {
			thumb.src = asAssetPath(CARD_BACK_ASSET);
		};
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

function hideChoiceWaitingModal() {
	const modal = document.getElementById("choiceWaitingModal") as HTMLElement | null;
	if (modal) modal.style.display = "none";
	if (activeWaitingTimer) {
		window.clearInterval(activeWaitingTimer);
		activeWaitingTimer = null;
	}
	const countdown = document.getElementById("choiceWaitingCountdown") as HTMLElement | null;
	if (countdown) {
		countdown.style.display = "none";
		countdown.classList.remove("is-danger");
	}
}

function showEffectChoiceModal(payload: any) {
	const modal = document.getElementById("cardChoiceModal") as HTMLElement | null;
	const title = document.getElementById("cardChoiceTitle");
	const grid = document.getElementById("cardChoiceGrid") as HTMLElement | null;
	if (!modal || !title || !grid) return;
	activeChoiceId = String(payload?.choiceId || "");
	title.textContent = String(payload?.title || "Escolha uma opção");
	hideChoiceWaitingModal();
	grid.innerHTML = "";
	grid.style.display = "block";

	const layout = document.createElement("div");
	layout.style.display = "grid";
	layout.style.gridTemplateColumns = "minmax(0, 1.9fr) minmax(260px, 300px)";
	layout.style.gap = "12px";
	layout.style.alignItems = "start";

	const choicesWrap = document.createElement("div");
	choicesWrap.style.display = "grid";
	choicesWrap.style.gap = "10px";

	const previewWrap = document.createElement("div");
	previewWrap.style.display = "grid";
	previewWrap.style.gap = "8px";
	previewWrap.style.alignContent = "start";
	previewWrap.style.minWidth = "0";
	const previewImg = document.createElement("img");
	previewImg.style.width = "100%";
	previewImg.style.maxWidth = "280px";
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
	previewWrap.appendChild(previewImg);
	previewWrap.appendChild(previewMeta);

	const options = Array.isArray(payload?.options) ? payload.options : [];
	const isMultiSelect = payload?.multiSelect === true;
	const selectedOptionIds = new Set<string>();
	const minSelections = Math.max(0, Number(payload?.minSelections || 0));
	const rawMaxSelections = Number(payload?.maxSelections || 0);
	const hasMaxSelections = Number.isFinite(rawMaxSelections) && rawMaxSelections > 0;
	let submitButton: HTMLButtonElement | null = null;
	const updateSubmitState = () => {
		if (!submitButton) return;
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
			if (!room || !activeChoiceId) return;
			room.send("effect_choice_submit", { choiceId: activeChoiceId, optionId: Array.from(selectedOptionIds).join("|") });
			hideCardChoiceModal(false);
		};
		updateSubmitState();
		previewWrap.appendChild(submitButton);
	}
	const hasSide = options.some((option: any) => option?.side != null);
	const sideGroups = hasSide
		? [
			{ key: "you", label: "Seu", options: options.filter((o: any) => sideFromServerSlot(String(o?.side || "") as "p1" | "p2") === "you") },
			{ key: "ai", label: "Oponente", options: options.filter((o: any) => sideFromServerSlot(String(o?.side || "") as "p1" | "p2") === "ai") },
			{ key: "other", label: "Outros", options: options.filter((o: any) => !["you", "ai"].includes(String(sideFromServerSlot(String(o?.side || "") as "p1" | "p2") || ""))) }
		]
		: [{ key: "all", label: "Opções", options }];

	for (const group of sideGroups) {
		if (!group.options.length) continue;
		const groupTitle = document.createElement("div");
		groupTitle.textContent = group.label;
		groupTitle.style.fontSize = "12px";
		groupTitle.style.fontWeight = "700";
		groupTitle.style.opacity = "0.9";
		choicesWrap.appendChild(groupTitle);

		const groupGrid = document.createElement("div");
		groupGrid.style.display = "grid";
		groupGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(84px, 1fr))";
		groupGrid.style.gap = "8px";

		for (const option of group.options) {
		const item = document.createElement("div");
		item.style.display = "grid";
		item.style.gap = "4px";
		item.style.alignContent = "start";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "card slotCard";
		button.style.width = "84px";
		button.style.height = "118px";
		const disabled = !!option?.disabled;
		button.style.cursor = disabled ? "not-allowed" : "pointer";
		if (disabled) button.style.opacity = "0.45";
		button.disabled = disabled;
		const visual = getChoiceOptionVisual(option, payload);
		const cardId = visual.cardId || String(option?.cardId || option?.label || "");
		const card = resolveCard(cardId);
		button.classList.toggle("choiceCardMuted", visual.muted);
		if (card?.img) {
			const image = document.createElement("img");
			image.className = "slotCardImg";
			image.src = asAssetPath(card.img);
			image.alt = card.name || cardId;
			image.onerror = () => {
				image.src = asAssetPath(CARD_BACK_ASSET);
			};
			button.appendChild(image);
		} else {
			const fallback = document.createElement("div");
			fallback.className = "slotCardFallback";
			fallback.textContent = String(option?.label || "Escolher");
			button.appendChild(fallback);
		}
		button.title = disabled
			? String(option?.disabledReason || option?.label || "Indisponível")
			: String(option?.label || cardId || "Escolher");
		button.onmouseenter = () => {
			if (!cardId) return;
			setInspector(cardId);
			previewImg.src = asAssetPath(card?.img || CARD_BACK_ASSET);
			previewImg.style.filter = visual.muted ? "grayscale(1) saturate(0.15) contrast(1.05) brightness(0.92)" : "none";
			previewMeta.textContent = [String(option?.description || option?.label || "").trim(), cardPreviewDetails(cardId, card, false, false)].filter(Boolean).join("\n\n");
		};
		button.onclick = () => {
			if (disabled) return;
			if (!room || !activeChoiceId) return;
			if (isMultiSelect) {
				const currentId = String(option?.id || "");
				if (!currentId) return;
				if (selectedOptionIds.has(currentId)) selectedOptionIds.delete(currentId);
				else {
					if (hasMaxSelections && selectedOptionIds.size >= rawMaxSelections) return;
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
		optionText.style.fontSize = "11px";
		optionText.style.lineHeight = "1.2";
		optionText.style.opacity = "0.95";
		optionText.style.minHeight = "28px";
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

	if (window.innerWidth <= 980) {
		layout.style.gridTemplateColumns = "1fr";
		previewWrap.style.order = "-1";
	}

	layout.appendChild(choicesWrap);
	layout.appendChild(previewWrap);
	grid.appendChild(layout);
	modal.style.display = "flex";
}

function renderDeckSlot(slotId: "you-deck" | "ai-deck", countId: "youDeckCount" | "aiDeckCount", total: number) {
	const slotEl = document.getElementById(slotId);
	const countEl = document.getElementById(countId);
	if (countEl) countEl.textContent = String(Math.max(0, Number(total || 0)));
	if (!slotEl) return;
	for (const old of Array.from(slotEl.querySelectorAll(":scope > .deckVisualCard"))) old.remove();
	if (Number(total || 0) <= 0) return;
	const back = document.createElement("div");
	back.className = "card slotCard slotCardBack deckVisualCard";
	back.style.width = "100%";
	back.style.height = "100%";
	back.style.margin = "0";
	const image = document.createElement("img");
	image.className = "slotCardImg";
	image.src = asAssetPath(CARD_BACK_ASSET);
	image.alt = "Deck";
	back.appendChild(image);
	slotEl.appendChild(back);
}

function renderPileCounts(prefix: "you" | "ai", data: any) {
	const graveCards = asStringArray(data?.grave);
	const banCards = asStringArray((data as any)?.banished || (data as any)?.ban);
	const deckCards = asStringArray(data?.deck);
	const previousGrave = prefix === "you" ? currentMyGrave : currentEnemyGrave;
	const previousBanished = prefix === "you" ? currentMyBanished : currentEnemyBanished;
	const graveCount = graveCards.length;
	const banCount = banCards.length;
	const deckCount = deckCards.length;
	const graveEl = document.getElementById(`${prefix}GraveCount`);
	const banEl = document.getElementById(`${prefix}BanCount`);
	if (graveEl) graveEl.textContent = String(Math.max(0, graveCount));
	if (banEl) banEl.textContent = String(Math.max(0, banCount));
	renderDeckSlot(prefix === "you" ? "you-deck" : "ai-deck", prefix === "you" ? "youDeckCount" : "aiDeckCount", deckCount);
	renderVisiblePileSlot(`${prefix}-grave`, `${prefix}GraveCount`, graveCards, false);
	renderVisiblePileSlot(`${prefix}-banished`, `${prefix}BanCount`, banCards, false);
	animatePileEntryIfNeeded(`${prefix}-grave`, previousGrave, graveCards);
	animatePileEntryIfNeeded(`${prefix}-banished`, previousBanished, banCards);
}

function getFirstEmptyFieldPos(field: string[]): number {
	for (let index = 0; index < 5; index += 1) {
		if (!field[index]) return index;
	}
	return -1;
}

function tryPlayCard(cardId: string, targetPos?: number): void {
	if (!room || !isMyTurn || currentPhase !== "PREP") return;
	if (!cardId) return;
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
	if (firstEmpty >= 0) room.send("play_card", { cardId, targetPos: firstEmpty, cardKind });
}

function renderEnvSlot(slotId: "you-env" | "ai-env", envCardId: string | null, allowDrop: boolean): void {
	const slotEl = document.getElementById(slotId);
	if (!slotEl) return;
	const side: BattleSide = slotId === "you-env" ? "you" : "ai";
	for (const oldCard of Array.from(slotEl.querySelectorAll(":scope > .card"))) oldCard.remove();
	slotEl.classList.remove("dropTarget");
	slotEl.ondragenter = null;
	slotEl.ondragover = null;
	slotEl.ondragleave = null;
	slotEl.ondrop = null;
	if (allowDrop) {
		slotEl.ondragenter = (event) => {
			event.preventDefault();
			if (!isMyTurn || currentPhase !== "PREP") return;
			const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
			if (!draggedCardId || laneForCard(draggedCardId) !== "env") return;
			slotEl.classList.add("dropTarget");
		};
		slotEl.ondragover = (event) => {
			event.preventDefault();
			if (!isMyTurn || currentPhase !== "PREP") return;
			const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
			if (!draggedCardId || laneForCard(draggedCardId) !== "env") return;
			slotEl.classList.add("dropTarget");
		};
		slotEl.ondragleave = () => slotEl.classList.remove("dropTarget");
		slotEl.ondrop = (event) => {
			event.preventDefault();
			slotEl.classList.remove("dropTarget");
			if (!isMyTurn || currentPhase !== "PREP") return;
			const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
			if (!draggedCardId || laneForCard(draggedCardId) !== "env") return;
			selectedHandCardId = draggedCardId;
			if (view.selectedCardEl) view.selectedCardEl.textContent = selectedHandCardId;
			tryPlayCard(draggedCardId);
		};
	}
	const cardId = String(envCardId || "").trim();
	if (!cardId) return;
	const cardEl = buildHandCard(cardId, false, undefined, { cardId, side, lane: "env" });
	cardEl.className = "card slotCard";
	cardEl.style.width = "100%";
	cardEl.style.height = "100%";
	cardEl.style.margin = "0";
	slotEl.onmousemove = () => setHoveredInspector({ cardId, side, lane: "env" });
	slotEl.onmouseleave = () => setHoveredInspector(null);
	slotEl.appendChild(cardEl);
}

function renderSideHand(containerId: "youHand" | "aiHand", cards: string[], selectable: boolean): void {
	const container = document.getElementById(containerId);
	if (!container) return;
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
					selectedHandCardId = cardId;
					if (view.selectedCardEl) view.selectedCardEl.textContent = selectedHandCardId;
					if (room && isMyTurn && currentPhase === "PREP") {
						tryPlayCard(cardId);
						return;
					}
					renderSideHand("youHand", cards, true);
				}, { cardId, side: "you", lane: "hand" });
			container.appendChild(cardEl);
			if (newEntryFlags[renderedIndex]) animateEl(cardEl, "anim-draw");
			renderedIndex += 1;
			continue;
		}
		const backCardEl = buildBackCard();
		backCardEl.dataset.cardId = cardId;
		container.appendChild(backCardEl);
		if (newEntryFlags[renderedIndex]) animateEl(backCardEl, "anim-draw");
		renderedIndex += 1;
	}
	previousHandCards[containerId] = cards.slice();
}

function renderLane(zoneId: "you-field" | "ai-field" | "you-support" | "ai-support", cards: string[], activeIndex: number | null, onClick?: (index: number) => void, hpValues?: number[]): void {
	const zone = document.getElementById(zoneId);
	if (!zone) return;
	const previousCards = previousLaneCards[zoneId] || [];
	const slots = Array.from(zone.children) as HTMLElement[];
	for (let index = 0; index < slots.length; index += 1) {
		const slotEl = slots[index];
		clearAttackTargetHover(slotEl);
		const incomingCardId = String(cards[index] || "");
		if (zoneId === "you-field") slotEl.id = `you-ally-${index}`;
		else if (zoneId === "ai-field") slotEl.id = `ai-ally-${index}`;
		else if (zoneId === "you-support") slotEl.id = `you-support-${index}`;
		else if (zoneId === "ai-support") slotEl.id = `ai-support-${index}`;
		const existingCard = slotEl.querySelector(":scope > .card") as HTMLElement | null;
		if (existingCard && previousCards[index] && previousCards[index] !== incomingCardId) {
			if (!consumeLanePileFlight(zoneId, previousCards[index])) spawnDeathGhost(slotEl, existingCard);
		}
		for (const oldCard of Array.from(slotEl.querySelectorAll(":scope > .card"))) oldCard.remove();
		slotEl.classList.remove("clickable", "selected", "dropTarget", "combat-target");
		slotEl.onclick = null;
		slotEl.ondragenter = null;
		slotEl.ondragover = null;
		slotEl.ondragleave = null;
		slotEl.ondrop = null;
		if (zoneId === "you-field" || zoneId === "you-support") {
			const dropLane: "field" | "support" = zoneId === "you-field" ? "field" : "support";
			slotEl.ondragenter = (event) => {
				event.preventDefault();
				if (!isMyTurn || currentPhase !== "PREP") return;
				const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
				if (!draggedCardId || laneForCard(draggedCardId) !== dropLane) return;
				slotEl.classList.add("dropTarget");
			};
			slotEl.ondragover = (event) => {
				event.preventDefault();
				if (!isMyTurn || currentPhase !== "PREP") return;
				const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
				if (!draggedCardId || laneForCard(draggedCardId) !== dropLane) return;
				slotEl.classList.add("dropTarget");
			};
			slotEl.ondragleave = () => slotEl.classList.remove("dropTarget");
			slotEl.ondrop = (event) => {
				event.preventDefault();
				slotEl.classList.remove("dropTarget");
				if (!isMyTurn || currentPhase !== "PREP") return;
				if (cards[index]) return;
				const draggedCardId = event.dataTransfer?.getData("text/plain") || selectedHandCardId || "";
				if (!draggedCardId) return;
				if (laneForCard(draggedCardId) !== dropLane) return;
				selectedHandCardId = draggedCardId;
				if (view.selectedCardEl) view.selectedCardEl.textContent = selectedHandCardId;
				tryPlayCard(draggedCardId, index);
			};
		}
		const cardId = cards[index];
		if (!cardId) {
			slotEl.onmousemove = null;
			slotEl.onmouseleave = null;
			continue;
		}
		const side: BattleSide = zoneId.startsWith("you") ? "you" : "ai";
		const lane: InspectorLane = zoneId.endsWith("field") ? "field" : "support";
		const cardEl = buildHandCard(cardId, false, undefined, { cardId, side, lane, index });
		cardEl.className = "card slotCard";
		if (zoneId === "you-field" && tappedBySide.you.has(index)) cardEl.classList.add("tapped");
		if (zoneId === "ai-field" && tappedBySide.ai.has(index)) cardEl.classList.add("tapped");
		if (zoneId === "you-field" && canSelectCombatAttacker(index)) cardEl.classList.add("can-attack");
		if (zoneId === "ai-field" && canSelectCombatTarget({ type: "ally", side: "ai", index })) cardEl.classList.add("can-be-targeted");
		const renderSide: BattleSide = side;
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
			appendSupportCounterTag(cardEl, getSupportCounterForSide(renderSide, index));
		}
		slotEl.onmousemove = () => setHoveredInspector({ cardId, side, lane, index });
		slotEl.onmouseleave = () => setHoveredInspector(null);
		slotEl.appendChild(cardEl);
		if (!previousCards[index] && cardId) animateEl(cardEl, "anim-play");
		if (activeIndex === index) slotEl.classList.add("selected");
		if (zoneId === "ai-field" && canSelectCombatTarget({ type: "ally", side: "ai", index })) slotEl.classList.add("combat-target");
		if (onClick) {
			const allowClick = zoneId === "ai-field"
				? (selectedAttackerPos === null || currentPhase !== "COMBAT" || !isMyTurn || canSelectCombatTarget({ type: "ally", side: "ai", index }))
				: (zoneId !== "you-field" || currentPhase !== "COMBAT" || canSelectCombatAttacker(index));
			if (allowClick) {
				slotEl.classList.add("clickable");
				slotEl.onclick = () => onClick(index);
				if (zoneId === "ai-field" && isMyTurn && currentPhase === "COMBAT" && selectedAttackerPos !== null && canSelectCombatTarget({ type: "ally", side: "ai", index })) {
					(slotEl as HTMLElement & { __attackHoverCleanup?: (() => void) | null }).__attackHoverCleanup = bindAttackTargetHover(slotEl);
				}
			}
		}
	}
	previousLaneCards[zoneId] = cards.slice();
}

function renderLeaderSlot(slotId: "you-leader" | "ai-leader", leaderId: string, currentHpValue?: number): void {
	const slotEl = document.getElementById(slotId);
	if (!slotEl) return;
	for (const oldCard of Array.from(slotEl.querySelectorAll(":scope > .card"))) oldCard.remove();
	const leader = String(leaderId || "").trim();
	if (!leader) return;
	const side: BattleSide = slotId === "you-leader" ? "you" : "ai";
	const cardEl = buildHandCard(leader, false, undefined, { cardId: leader, side, lane: "leader" });
	cardEl.className = "card slotCard";
	const tapped = side === "you" ? currentMyLeaderTapped : currentEnemyLeaderTapped;
	const leaderPowerReady = side === "you" && hasManualLeaderPower(leader) && canUseLeaderPower();
	if (tapped) cardEl.classList.add("tapped");
	if (untapPulseBySide[side] && justUntappedLeaderBySide[side]) cardEl.classList.add("just-untapped");
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

	slotEl.appendChild(cardEl);
}

function getFieldVitalMarksForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMyFieldVitalMarks : currentEnemyFieldVitalMarks;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function getFieldBloodMarksForSide(side: BattleSide, index: number): number {
	const source = side === "you" ? currentMyFieldBloodMarks : currentEnemyFieldBloodMarks;
	const value = Number(source[index] || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function getDisplayedFieldMaxHp(side: BattleSide, index: number, cardId: string): number {
	const baseMaxHp = Number(resolveCard(cardId)?.hp || 1);
	return Math.max(1, baseMaxHp
		+ getFieldVitalMarksForSide(side, index)
		+ getFieldBlessingForSide(side, index)
		+ getAttachedSupportNumericBonusForSide(side, index, "hpBonus")
		+ getAuraHpBonusForSide(side, cardId));
}

function appendMarkerTag(cardEl: HTMLElement, text: string, background: string, color: string): void {
	const offsetIndex = cardEl.querySelectorAll(":scope > .markerTag").length;
	const tag = document.createElement("div");
	tag.className = "markerTag";
	tag.textContent = text;
	tag.style.top = `${4 + (offsetIndex * 20)}px`;
	tag.style.background = background;
	tag.style.color = color;
	cardEl.appendChild(tag);
}

function appendVitalTag(cardEl: HTMLElement, marks: number): void {
	const total = Math.max(0, Number(marks || 0));
	if (!total) return;
	appendMarkerTag(cardEl, `🍀 ${total}`, "rgba(22, 101, 52, 0.92)", "#f0fdf4");
}

function appendSpiderTag(cardEl: HTMLElement, marks: number): void {
	const total = Math.max(0, Number(marks || 0));
	if (!total) return;
	appendMarkerTag(cardEl, `🕷 ${total}`, "rgba(17, 24, 39, 0.94)", "#f9fafb");
}

function appendBloodTag(cardEl: HTMLElement, marks: number): void {
	const total = Math.max(0, Number(marks || 0));
	if (!total) return;
	appendMarkerTag(cardEl, `🩸 ${total}`, "rgba(153, 27, 27, 0.94)", "#fef2f2");
}

function getFragImage(playerState: any): string {
	const leader = resolveCard(String(playerState?.leaderId || ""));
	const source = String(playerState?.filiacao || leader?.filiacao || leader?.classe || "");
	const normalized = normalizeKind(source);
	if (normalized.includes("arcan")) return asAssetPath("fragments/layout-fragmento_arcano.png");
	if (normalized.includes("marcial")) return asAssetPath("fragments/layout-fragmento_marcial.png");
	if (normalized.includes("santa") || normalized.includes("relig")) return asAssetPath("fragments/layout-fragmento_religioso.png");
	if (normalized.includes("sombr")) return asAssetPath("fragments/layout-fragmento_sombras.png");
	return asAssetPath("fragments/FRAGMENTOS.png");
}

function renderFragments(containerId: "you-fragsDock" | "ai-fragsDock", total: unknown, maxTotal: unknown, fragImage: string, spentFirst: boolean = false): void {
	const container = document.getElementById(containerId);
	if (!container) return;
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
		if (index >= activeStartIndex && index < activeStartIndex + amount) token.classList.add("on");
		container.appendChild(token);
	}
}

function formatPhaseLabel(phase: unknown): string {
	const value = String(phase || "—");
	if (value === "INITIAL") return "Inicial";
	return value;
}

function asStringArray(value: any): string[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((v) => String(v));
	if (typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<any>).map((v) => String(v));
	if (typeof value === "object") return Object.keys(value).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).map((k) => String(value[k]));
	return [];
}

function asNumberArray(value: any): number[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((v) => Number(v || 0));
	if (typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<any>).map((v) => Number(v || 0));
	if (typeof value === "object") {
		return Object.keys(value)
			.filter((k) => /^\d+$/.test(k))
			.sort((a, b) => Number(a) - Number(b))
			.map((k) => Number(value[k] || 0));
	}
	return [];
}

function asBoolArray(value: any): boolean[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((v) => !!v);
	if (typeof value[Symbol.iterator] === "function") return Array.from(value as Iterable<any>).map((v) => !!v);
	if (typeof value === "object") {
		return Object.keys(value)
			.filter((k) => /^\d+$/.test(k))
			.sort((a, b) => Number(a) - Number(b))
			.map((k) => !!value[k]);
	}
	return [];
}

function inferSlotFromState(state: any): "p1" | "p2" | null {
	const resolvedSessionId = selfSessionId || (typeof room?.sessionId === "string" ? room.sessionId : null);
	if (!resolvedSessionId) return null;
	const players = state?.players;
	if (!players) return null;
	if (typeof players.get === "function") {
		const p = players.get(resolvedSessionId);
		if (p?.slot === "p1" || p?.slot === "p2") return p.slot;
	}
	const byKey = players[resolvedSessionId];
	if (byKey?.slot === "p1" || byKey?.slot === "p2") return byKey.slot;
	for (const key of Object.keys(players)) {
		const p = players[key];
		if (p?.sessionId === resolvedSessionId && (p?.slot === "p1" || p?.slot === "p2")) return p.slot;
	}
	return null;
}

function getPublicPlayerName(state: any, targetSlot: "p1" | "p2"): string {
	const fallback = targetSlot === "p1" ? "Jogador 1" : "Jogador 2";
	const players = state?.players;
	if (!players || typeof players !== "object") return fallback;
	for (const player of Object.values(players as Record<string, any>)) {
		if (player?.slot !== targetSlot) continue;
		const displayName = String(player?.displayName || "").trim();
		return displayName || fallback;
	}
	return fallback;
}

function syncHandTitles(state: any): void {
	const enemyHandTitleEl = document.querySelector("#enemyHandDock .handDockTitle") as HTMLElement | null;
	const myHandTitleEl = document.querySelector("#youHandDock .handDockTitle") as HTMLElement | null;
	const enemyHandEl = document.getElementById("aiHand");
	const myHandEl = document.getElementById("youHand");
	if (!enemyHandTitleEl || !myHandTitleEl || !enemyHandEl || !myHandEl) return;
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

function updateArenaTurnPriority(myTurn: boolean): void {
	const myArena = document.getElementById("youArena");
	const enemyArena = document.getElementById("opArena");
	if (!myArena || !enemyArena) return;
	const applyState = (el: HTMLElement, active: boolean, muted: boolean) => {
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
	const endpoint = view.endpointEl?.value?.trim() || resolveServerEndpoint(window.location.search);
	window.location.href = `./lobby.html?endpoint=${encodeURIComponent(endpoint)}`;
}

function clearSpectatorReconnectTimer() {
	if (spectatorReconnectTimer) {
		window.clearTimeout(spectatorReconnectTimer);
		spectatorReconnectTimer = null;
	}
}

async function reconnectSpectator(): Promise<boolean> {
	if (!isSpectator || !spectatorMatchRoomId || !view.endpointEl) return false;
	try {
		const endpoint = view.endpointEl.value.trim();
		const targetJoinRoomId = await resolveSpectatorRoomId(endpoint, spectatorMatchRoomId);
		room = await joinMatchById(client, targetJoinRoomId, {});
		roomId = room.id;
		selfSessionId = typeof room?.sessionId === "string" ? room.sessionId : selfSessionId;
		slot = "p1";
		bindActiveMatchRoom();
		logText("Reconectado ao modo espectador.");
		spectatorReconnectAttempts = 0;
		return true;
	} catch (error) {
		log("ERROR", { text: `Falha ao reconectar espectador: ${String(error)}` });
		return false;
	}
}

function scheduleSpectatorReconnect(code: number) {
	if (!isSpectator || !spectatorMatchRoomId) {
		setTimeout(() => goLobby(), 900);
		return;
	}
	if (spectatorReconnectAttempts >= 3) {
		log("DISCONNECTED", { code, text: "Conexão do espectador encerrada. Voltando ao lobby..." });
		setTimeout(() => goLobby(), 900);
		return;
	}
	clearSpectatorReconnectTimer();
	const nextAttempt = spectatorReconnectAttempts + 1;
	spectatorReconnectAttempts = nextAttempt;
	logText(`Reconectando espectador (${nextAttempt}/3)...`);
	spectatorReconnectTimer = window.setTimeout(() => {
		void reconnectSpectator().then((ok) => {
			if (!ok) scheduleSpectatorReconnect(code);
		});
	}, 700);
}

function bindActiveMatchRoom() {
	if (!room) return;
	bindMatchHandlers(room, {
		onAssignSlot: (msg) => {
			isSpectator = msg?.spectator === true || isSpectator;
			slot = isSpectator ? "p1" : (msg?.slot || null);
			selfSessionId = typeof msg?.sessionId === "string" ? msg.sessionId : null;
			log("ASSIGN_SLOT", msg);
		},
		onCardPlayed: (msg) => {
			diaryCardPlayed(msg);
			const side = sideFromServerSlot((msg?.slot || "") as "p1" | "p2");
			if (!side) return;
			if (String(msg?.lane || "") !== "field") return;
			const targetPos = Number(msg?.targetPos);
			if (!Number.isInteger(targetPos) || targetPos < 0) return;
			summonedBySide[side].add(targetPos);
		},
		onEffectChoice: (msg) => {
			if (!isSpectator) showEffectChoiceModal(msg);
		},
		onRevealTopCard: (msg) => {
			if (!isSpectator) showRevealTopCardModal(msg);
		},
		onError: (msg) => log("ERROR", msg),
		onLeave: (code) => {
			hideCardChoiceModal(false);
			hideChoiceWaitingModal();
			if (isSpectator) {
				scheduleSpectatorReconnect(code);
				return;
			}
			log("DISCONNECTED", { code, text: "Conexão encerrada. Voltando ao lobby..." });
			setTimeout(() => goLobby(), 900);
		},
		onLog: (name, msg) => {
			if (name === "ATTACK_RESOLVED") diaryAttackResolved(msg);
			else if (name === "TURN_START") diaryTurnStart(msg);
			else if (name === "EFFECT") diaryEffect(msg);
			else if (name === "CHOICE_WAITING") {
				if (!isSpectator) {
					showChoiceWaitingModal(msg);
					logText(`⏳ Seu oponente está escolhendo: ${String(msg?.title || "uma opção")}.`);
				}
			}
			else if (name === "CHOICE_WAITING_END") {
				if (!isSpectator) hideChoiceWaitingModal();
			}
			else if (name === "MATCH_ENDED") {
				const winner = ownerLabel(String(msg?.winner || ""));
				logText(`🏁 Partida encerrada. Vencedor: ${winner}.`);
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
				const side = sideFromServerSlot((msg?.slot || "") as "p1" | "p2");
				const effect = String(msg?.effect || "").trim();
				if (side && ["valbrak_citizen_boost", "ademais_spider_burst", "leafae_vital_guard"].includes(effect)) {
					animateChosenPowerActivation(side);
				}
			}
			if (name === "TURN_START") {
				const side = sideFromServerSlot((msg?.turnSlot || "") as "p1" | "p2");
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
				const side = sideFromServerSlot((msg?.attackerSlot || "") as "p1" | "p2");
				const attackerPos = Number(msg?.attackerPos);
				if (!side) return;
				if (Number.isInteger(attackerPos) && attackerPos >= 0) tappedBySide[side].add(attackerPos);
				if (msg?.attackerLeader === true || msg?.attacker === "leader" || attackerPos === -1) tappedLeaderBySide[side] = true;
			}
		},
		onStateSync: (state) => {
			if (view.turnPhaseEl) view.turnPhaseEl.textContent = formatPhaseLabel(state?.game?.phase);
			if (view.roomIdViewEl) view.roomIdViewEl.textContent = roomId ?? "—";
			if (view.slotEl) view.slotEl.textContent = isSpectator ? "Espectador" : (slot ?? "—");
			if (view.turnEl) view.turnEl.textContent = String(state?.game?.turn ?? "—");
			if (view.turnSlotEl) view.turnSlotEl.textContent = String(state?.game?.turnSlot ?? "—");
			if (view.p1HpEl) view.p1HpEl.textContent = String(state?.game?.p1?.hp ?? "—");
			if (view.p2HpEl) view.p2HpEl.textContent = String(state?.game?.p2?.hp ?? "—");
			if (view.p1FragmentsEl) view.p1FragmentsEl.textContent = String(state?.game?.p1?.fragments ?? "—");
			if (view.p2FragmentsEl) view.p2FragmentsEl.textContent = String(state?.game?.p2?.fragments ?? "—");
			if (view.p1HandCountEl) view.p1HandCountEl.textContent = String(state?.game?.p1?.hand?.length ?? "—");
			if (view.p2HandCountEl) view.p2HandCountEl.textContent = String(state?.game?.p2?.hand?.length ?? "—");

			if (isSpectator && !slot) slot = "p1";
			if (!slot && !isSpectator) slot = inferSlotFromState(state);
			if (!slot) return;
			syncHandTitles(state);

			const previousMyField = currentMyField.slice();
			const previousMyFieldHp = currentMyFieldHp.slice();
			const previousMySupport = currentMySupport.slice();
			const previousMyEnv = currentMyEnv;
			const previousMyGrave = currentMyGrave.slice();
			const previousMyBanished = currentMyBanished.slice();
			const previousMyHand = previousHandCards.youHand.slice();
			const myHandTransferSnapshots = captureHandTransferSnapshots("youHand");
			const previousEnemyHand = previousHandCards.aiHand.slice();
			const enemyHandTransferSnapshots = captureHandTransferSnapshots("aiHand");
			const previousEnemyField = currentEnemyField.slice();
			const previousEnemyFieldHp = currentEnemyFieldHp.slice();
			const previousEnemySupport = currentEnemySupport.slice();
			const previousEnemyGrave = currentEnemyGrave.slice();
			const previousEnemyBanished = currentEnemyBanished.slice();
			const boardTransferSnapshots = captureLaneTransferSnapshots(["you-field", "you-support", "ai-field", "ai-support"]);
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
				const startedSide = sideFromServerSlot((state?.game?.turnSlot || "") as "p1" | "p2");
				if (startedSide === "you") myTurnCount += 1;
				if (startedSide === "ai") enemyTurnCount += 1;
			}
			const hand = asStringArray(my?.hand);
			currentMyDeck = asStringArray(my?.deck);
			currentMyGrave = asStringArray(my?.grave);
			currentMyBanished = asStringArray((my as any)?.banished || (my as any)?.ban);
			const myField = asStringArray(my?.field);
			const myFieldHp = asNumberArray(my?.fieldHp);
			const myFieldAtkTemp = asNumberArray((my as any)?.fieldAtkTemp);
			const myFieldAtkPerm = asNumberArray((my as any)?.fieldAtkPerm);
			const myFieldAcPerm = asNumberArray((my as any)?.fieldAcPerm);
			const myFieldBlessing = asNumberArray((my as any)?.fieldBlessing);
			const myFieldBlood = asNumberArray((my as any)?.fieldBloodMarks);
			const myFieldVital = asNumberArray((my as any)?.fieldVitalMarks);
			const myFieldTapped = asBoolArray((my as any)?.fieldTapped);
			tappedBySide.you.clear();
			for (let i = 0; i < myFieldTapped.length; i += 1) if (myFieldTapped[i]) tappedBySide.you.add(i);
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
			currentMySupportAttach = asNumberArray((my as any)?.supportAttachTo);
			currentMySupportCounters = asNumberArray((my as any)?.supportCounters);
			currentMyEnv = String(my?.env || "") || null;
			currentMyLeader = String(my?.leaderId || "");
			currentMyLeaderHp = Number(my?.hp ?? 0);
			currentMyLeaderTapped = !!(my as any)?.leaderTapped;
			currentMyLeaderBlessing = Number((my as any)?.leaderBlessing || 0);
			currentMyLeaderVitalMarks = Number((my as any)?.leaderVitalMarks || 0);
			currentMyLeaderSpiderMarks = Number((my as any)?.leaderSpiderMarks || 0);
			const enemyField = asStringArray(enemy?.field);
			currentEnemyDeck = asStringArray(enemy?.deck);
			currentEnemyGrave = asStringArray(enemy?.grave);
			currentEnemyBanished = asStringArray((enemy as any)?.banished || (enemy as any)?.ban);
			const enemyFieldHp = asNumberArray(enemy?.fieldHp);
			const enemyFieldAtkTemp = asNumberArray((enemy as any)?.fieldAtkTemp);
			const enemyFieldAtkPerm = asNumberArray((enemy as any)?.fieldAtkPerm);
			const enemyFieldAcPerm = asNumberArray((enemy as any)?.fieldAcPerm);
			const enemyFieldBlessing = asNumberArray((enemy as any)?.fieldBlessing);
			const enemyFieldBlood = asNumberArray((enemy as any)?.fieldBloodMarks);
			const enemyFieldVital = asNumberArray((enemy as any)?.fieldVitalMarks);
			const enemyFieldTapped = asBoolArray((enemy as any)?.fieldTapped);
			tappedBySide.ai.clear();
			for (let i = 0; i < enemyFieldTapped.length; i += 1) if (enemyFieldTapped[i]) tappedBySide.ai.add(i);
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
			currentEnemySupportAttach = asNumberArray((enemy as any)?.supportAttachTo);
			currentEnemySupportCounters = asNumberArray((enemy as any)?.supportCounters);
			const enemyEnv = String(enemy?.env || "") || null;
			currentEnemyEnv = enemyEnv;
			currentEnemyLeader = String(enemy?.leaderId || "");
			currentEnemyLeaderHp = Number(enemy?.hp ?? 0);
			currentEnemyLeaderTapped = !!(enemy as any)?.leaderTapped;
			currentEnemyLeaderBlessing = Number((enemy as any)?.leaderBlessing || 0);
			currentEnemyLeaderVitalMarks = Number((enemy as any)?.leaderVitalMarks || 0);
			currentEnemyLeaderSpiderMarks = Number((enemy as any)?.leaderSpiderMarks || 0);
			const myBoardCardsToPiles = getBoardCardsMovingToPiles(previousMyField, myField, previousMySupport, mySupport, previousMyGrave, currentMyGrave, previousMyBanished, currentMyBanished);
			const enemyBoardCardsToPiles = getBoardCardsMovingToPiles(previousEnemyField, enemyField, previousEnemySupport, enemySupport, previousEnemyGrave, currentEnemyGrave, previousEnemyBanished, currentEnemyBanished);
			queueLanePileFlights("you-field", myBoardCardsToPiles.field);
			queueLanePileFlights("you-support", myBoardCardsToPiles.support);
			queueLanePileFlights("ai-field", enemyBoardCardsToPiles.field);
			queueLanePileFlights("ai-support", enemyBoardCardsToPiles.support);
			const myShadowPenalty = hasShadowPenaltyForPlayer(my, currentMyLeader, currentMyEnv, enemyEnv);
			const enemyShadowPenalty = hasShadowPenaltyForPlayer(enemy, currentEnemyLeader, enemyEnv, currentMyEnv);
			const enemyHandCount = Number(enemy?.hand?.length ?? 0);
			const myTurn = !isSpectator && String(state?.game?.turnSlot || "") === slot;
			const phase = String(state?.game?.phase || "");
			if (phase !== currentPhase) {
				resetBoardAttackSelection();
				cancelBoardAttackSelection();
				animatePhaseChange(phase);
			}
			isMyTurn = myTurn;
			currentPhase = phase;
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
			if (myLeaderSlot) myLeaderSlot.onclick = null;
			syncEnemyLeaderCombatTargetState();
			renderEnvSlot("you-env", currentMyEnv, true);
			renderEnvSlot("ai-env", enemyEnv, false);
			renderPileCounts("you", my);
			renderPileCounts("ai", enemy);
			const pileModal = document.getElementById("pileModal") as HTMLElement | null;
			if (pileModal && pileModal.style.display === "flex") renderPileModal();
			renderSideHand("aiHand", Array.from({ length: enemyHandCount }, (_, index) => `opp-${index}`), false);
			if (selectedHandCardId && !hand.includes(selectedHandCardId)) selectedHandCardId = null;
			if (selectedAttackerPos !== null && (selectedAttackerPos < 0 || selectedAttackerPos >= myField.length)) selectedAttackerPos = null;
			if (selectedTargetType === "ally" && (selectedTargetPos === null || selectedTargetPos >= enemyField.length)) {
				selectedTargetType = "leader";
				selectedTargetPos = null;
				if (view.selectedTargetEl) view.selectedTargetEl.textContent = "Líder inimigo";
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
			if (view.btnPlay) view.btnPlay.disabled = isSpectator || !(myTurn && phase === "PREP" && !!selectedHandCardId);
			if (view.btnLeaderPower) {
				const showLeaderPower = hasManualLeaderPower(currentMyLeader);
				const leaderPowerReady = showLeaderPower && canUseLeaderPower();
				view.btnLeaderPower.style.display = !isSpectator && showLeaderPower ? "" : "none";
				view.btnLeaderPower.disabled = !leaderPowerReady;
				view.btnLeaderPower.classList.toggle("is-ready", leaderPowerReady);
			}
			if (view.btnAttack) view.btnAttack.disabled = isSpectator || !(myTurn && phase === "COMBAT" && selectedAttackerPos !== null);
			if (view.btnTargetLeader) view.btnTargetLeader.disabled = isSpectator || !(myTurn && phase === "COMBAT");
			if (view.btnNextPhase) view.btnNextPhase.disabled = isSpectator || !myTurn;
			if (view.btnEndTurn) view.btnEndTurn.disabled = isSpectator || !(myTurn && phase === "END");
		}
	});
}

function animatePhaseChange(phase: string) {
	animateEl(document.getElementById("phaseBar"), "anim-phase");
	animateEl(view.turnPhaseEl, "anim-phase");
	animateEl(document.querySelector(`.phaseItem[data-phase="${phase}"]`), "anim-phase");
}

function clearAttackTargetHover(el: HTMLElement | null) {
	const cleanup = (el as (HTMLElement & { __attackHoverCleanup?: (() => void) | null }) | null)?.__attackHoverCleanup;
	if (cleanup) cleanup();
	if (el) (el as HTMLElement & { __attackHoverCleanup?: (() => void) | null }).__attackHoverCleanup = null;
}

function spawnDeathGhost(slotEl: HTMLElement, sourceCard: HTMLElement) {
	const ghost = sourceCard.cloneNode(true) as HTMLElement;
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
}

function animateFieldDamage(side: BattleSide, previousCards: string[], nextCards: string[], previousHp: number[], nextHp: number[]) {
	for (let index = 0; index < nextCards.length; index += 1) {
		if (!nextCards[index] || previousCards[index] !== nextCards[index]) continue;
		const prev = Number(previousHp[index] ?? 0);
		const next = Number(nextHp[index] ?? 0);
		if (!(next < prev)) continue;
		animateEl(document.querySelector(`#${side}-ally-${index} > .card`), "anim-damage");
	}
}

function animateLeaderDamage(slotId: "you-leader" | "ai-leader", previousLeaderId: string, nextLeaderId: string, previousHp: number, nextHp: number) {
	if (!previousLeaderId || previousLeaderId !== nextLeaderId) return;
	if (!(Number(nextHp) < Number(previousHp))) return;
	animateEl(document.querySelector(`#${slotId} > .card`), "anim-damage");
}

function renderHand(hand: string[]) {
	if (isSpectator) {
		renderButtonRow("hand", [], null, "", () => undefined);
		renderSideHand("youHand", Array.from({ length: hand.length }, (_, index) => `spectator-${index}`), false);
		return;
	}
	renderButtonRow("hand", hand.map((c) => `${c} (Custo 1)`), hand.findIndex((c) => c === selectedHandCardId), "outline:2px solid #f8d46d;", (index) => {
		selectedHandCardId = hand[index] || null;
		if (view.selectedCardEl) view.selectedCardEl.textContent = selectedHandCardId || "—";
	});
	renderSideHand("youHand", hand, true);
}

function renderMyField(field: string[], hpValues: number[]) {
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

function renderEnemyField(field: string[], hpValues: number[]) {
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

function renderMySupport(support: string[]) {
	renderLane("you-support", support, null);
}

function renderEnemySupport(support: string[]) {
	renderLane("ai-support", support, null);
}

async function joinMatch() {
	if (isJoining || !view.endpointEl || !view.roomIdEl) return;
	const targetRoomId = view.roomIdEl.value.trim();
	const joinToken = new URLSearchParams(window.location.search).get("joinToken")?.trim() || "";
	const wantsSpectator = new URLSearchParams(window.location.search).get("spectator") === "1";
	if (!targetRoomId) return log("ERROR", { text: "Informe roomId da partida." });
	if (!wantsSpectator && !joinToken) return log("ERROR", { text: "Token da partida ausente. Entre novamente pelo lobby." });

	isJoining = true;
	try {
		const endpoint = view.endpointEl.value.trim();
		client = await connectClient(endpoint);
		isSpectator = wantsSpectator;
		spectatorMatchRoomId = wantsSpectator ? targetRoomId : null;
		clearSpectatorReconnectTimer();
		if (isSpectator && !slot) slot = "p1";
		const targetJoinRoomId = wantsSpectator ? await resolveSpectatorRoomId(endpoint, targetRoomId) : targetRoomId;
		room = await joinMatchById(client, targetJoinRoomId, wantsSpectator ? {} : { joinToken });
		roomId = room.id;
		selfSessionId = typeof room?.sessionId === "string" ? room.sessionId : selfSessionId;
		const displayName = getDisplayName();
		if (displayName && !isSpectator) {
			room.send("set_name", { name: displayName });
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
				const side = sideFromServerSlot((msg?.slot || "") as "p1" | "p2");
				if (!side) return;
				if (String(msg?.lane || "") !== "field") return;
				const targetPos = Number(msg?.targetPos);
				if (!Number.isInteger(targetPos) || targetPos < 0) return;
				summonedBySide[side].add(targetPos);
			},
			onEffectChoice: (msg) => {
				if (!isSpectator) showEffectChoiceModal(msg);
			},
			onRevealTopCard: (msg) => {
				if (!isSpectator) showRevealTopCardModal(msg);
			},
			onError: (msg) => log("ERROR", msg),
			onLeave: (code) => {
				hideCardChoiceModal(false);
				hideChoiceWaitingModal();
				if (isSpectator) {
					scheduleSpectatorReconnect(code);
					return;
				}
				log("DISCONNECTED", { code, text: "Conexão encerrada. Voltando ao lobby..." });
				setTimeout(() => goLobby(), 900);
			},
			onLog: (name, msg) => {
				if (name === "ATTACK_RESOLVED") diaryAttackResolved(msg);
				else if (name === "TURN_START") diaryTurnStart(msg);
				else if (name === "EFFECT") diaryEffect(msg);
				else if (name === "CHOICE_WAITING") {
					if (!isSpectator) {
						showChoiceWaitingModal(msg);
						logText(`⏳ Seu oponente está escolhendo: ${String(msg?.title || "uma opção")}.`);
					}
				}
				else if (name === "CHOICE_WAITING_END") {
					if (!isSpectator) hideChoiceWaitingModal();
				}
				else if (name === "MATCH_ENDED") {
					const winner = ownerLabel(String(msg?.winner || ""));
					logText(`🏁 Partida encerrada. Vencedor: ${winner}.`);
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
					const side = sideFromServerSlot((msg?.slot || "") as "p1" | "p2");
					const effect = String(msg?.effect || "").trim();
					if (side && ["valbrak_citizen_boost", "ademais_spider_burst", "leafae_vital_guard"].includes(effect)) {
						animateChosenPowerActivation(side);
					}
				}
				if (name === "TURN_START") {
					const side = sideFromServerSlot((msg?.turnSlot || "") as "p1" | "p2");
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
					const side = sideFromServerSlot((msg?.attackerSlot || "") as "p1" | "p2");
					const attackerPos = Number(msg?.attackerPos);
					if (!side) return;
					if (Number.isInteger(attackerPos) && attackerPos >= 0) tappedBySide[side].add(attackerPos);
					if (msg?.attackerLeader === true || msg?.attacker === "leader" || attackerPos === -1) tappedLeaderBySide[side] = true;
				}
			},
			onStateSync: (state) => {
				if (view.turnPhaseEl) view.turnPhaseEl.textContent = formatPhaseLabel(state?.game?.phase);
				if (view.roomIdViewEl) view.roomIdViewEl.textContent = roomId ?? "—";
				if (view.slotEl) view.slotEl.textContent = isSpectator ? "Espectador" : (slot ?? "—");
				if (view.turnEl) view.turnEl.textContent = String(state?.game?.turn ?? "—");
				if (view.turnSlotEl) view.turnSlotEl.textContent = String(state?.game?.turnSlot ?? "—");
				if (view.p1HpEl) view.p1HpEl.textContent = String(state?.game?.p1?.hp ?? "—");
				if (view.p2HpEl) view.p2HpEl.textContent = String(state?.game?.p2?.hp ?? "—");
				if (view.p1FragmentsEl) view.p1FragmentsEl.textContent = String(state?.game?.p1?.fragments ?? "—");
				if (view.p2FragmentsEl) view.p2FragmentsEl.textContent = String(state?.game?.p2?.fragments ?? "—");
				if (view.p1HandCountEl) view.p1HandCountEl.textContent = String(state?.game?.p1?.hand?.length ?? "—");
				if (view.p2HandCountEl) view.p2HandCountEl.textContent = String(state?.game?.p2?.hand?.length ?? "—");

				if (isSpectator && !slot) slot = "p1";
				if (!slot && !isSpectator) slot = inferSlotFromState(state);
				if (!slot) return;
				syncHandTitles(state);

				const previousMyField = currentMyField.slice();
				const previousMyFieldHp = currentMyFieldHp.slice();
				const previousMySupport = currentMySupport.slice();
				const previousMyEnv = currentMyEnv;
				const previousMyGrave = currentMyGrave.slice();
				const previousMyBanished = currentMyBanished.slice();
				const previousMyHand = previousHandCards.youHand.slice();
				const myHandTransferSnapshots = captureHandTransferSnapshots("youHand");
				const previousEnemyHand = previousHandCards.aiHand.slice();
				const enemyHandTransferSnapshots = captureHandTransferSnapshots("aiHand");
				const previousEnemyField = currentEnemyField.slice();
				const previousEnemyFieldHp = currentEnemyFieldHp.slice();
				const previousEnemySupport = currentEnemySupport.slice();
				const previousEnemyGrave = currentEnemyGrave.slice();
				const previousEnemyBanished = currentEnemyBanished.slice();
				const boardTransferSnapshots = captureLaneTransferSnapshots(["you-field", "you-support", "ai-field", "ai-support"]);
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
					const startedSide = sideFromServerSlot((state?.game?.turnSlot || "") as "p1" | "p2");
					if (startedSide === "you") myTurnCount += 1;
					if (startedSide === "ai") enemyTurnCount += 1;
				}
				const hand = asStringArray(my?.hand);
				currentMyDeck = asStringArray(my?.deck);
				currentMyGrave = asStringArray(my?.grave);
				currentMyBanished = asStringArray((my as any)?.banished || (my as any)?.ban);
				const myField = asStringArray(my?.field);
				const myFieldHp = asNumberArray(my?.fieldHp);
				const myFieldAtkTemp = asNumberArray((my as any)?.fieldAtkTemp);
				const myFieldAtkPerm = asNumberArray((my as any)?.fieldAtkPerm);
				const myFieldAcPerm = asNumberArray((my as any)?.fieldAcPerm);
				const myFieldBlessing = asNumberArray((my as any)?.fieldBlessing);
				const myFieldBlood = asNumberArray((my as any)?.fieldBloodMarks);
				const myFieldVital = asNumberArray((my as any)?.fieldVitalMarks);
				const myFieldTapped = asBoolArray((my as any)?.fieldTapped);
				tappedBySide.you.clear();
				for (let i = 0; i < myFieldTapped.length; i += 1) if (myFieldTapped[i]) tappedBySide.you.add(i);
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
				currentMySupportAttach = asNumberArray((my as any)?.supportAttachTo);
				currentMySupportCounters = asNumberArray((my as any)?.supportCounters);
				currentMyEnv = String(my?.env || "") || null;
				currentMyLeader = String(my?.leaderId || "");
				currentMyLeaderHp = Number(my?.hp ?? 0);
				currentMyLeaderTapped = !!(my as any)?.leaderTapped;
				currentMyLeaderBlessing = Number((my as any)?.leaderBlessing || 0);
				currentMyLeaderVitalMarks = Number((my as any)?.leaderVitalMarks || 0);
				currentMyLeaderSpiderMarks = Number((my as any)?.leaderSpiderMarks || 0);
				const enemyField = asStringArray(enemy?.field);
				currentEnemyDeck = asStringArray(enemy?.deck);
				currentEnemyGrave = asStringArray(enemy?.grave);
				currentEnemyBanished = asStringArray((enemy as any)?.banished || (enemy as any)?.ban);
				const enemyFieldHp = asNumberArray(enemy?.fieldHp);
				const enemyFieldAtkTemp = asNumberArray((enemy as any)?.fieldAtkTemp);
				const enemyFieldAtkPerm = asNumberArray((enemy as any)?.fieldAtkPerm);
				const enemyFieldAcPerm = asNumberArray((enemy as any)?.fieldAcPerm);
				const enemyFieldBlessing = asNumberArray((enemy as any)?.fieldBlessing);
				const enemyFieldBlood = asNumberArray((enemy as any)?.fieldBloodMarks);
				const enemyFieldVital = asNumberArray((enemy as any)?.fieldVitalMarks);
				const enemyFieldTapped = asBoolArray((enemy as any)?.fieldTapped);
				tappedBySide.ai.clear();
				for (let i = 0; i < enemyFieldTapped.length; i += 1) if (enemyFieldTapped[i]) tappedBySide.ai.add(i);
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
				currentEnemySupportAttach = asNumberArray((enemy as any)?.supportAttachTo);
				currentEnemySupportCounters = asNumberArray((enemy as any)?.supportCounters);
				const enemyEnv = String(enemy?.env || "") || null;
				currentEnemyEnv = enemyEnv;
				currentEnemyLeader = String(enemy?.leaderId || "");
				currentEnemyLeaderHp = Number(enemy?.hp ?? 0);
				currentEnemyLeaderTapped = !!(enemy as any)?.leaderTapped;
				currentEnemyLeaderBlessing = Number((enemy as any)?.leaderBlessing || 0);
				currentEnemyLeaderVitalMarks = Number((enemy as any)?.leaderVitalMarks || 0);
				currentEnemyLeaderSpiderMarks = Number((enemy as any)?.leaderSpiderMarks || 0);
				const myBoardCardsToPiles = getBoardCardsMovingToPiles(
					previousMyField,
					myField,
					previousMySupport,
					mySupport,
					previousMyGrave,
					currentMyGrave,
					previousMyBanished,
					currentMyBanished
				);
				const enemyBoardCardsToPiles = getBoardCardsMovingToPiles(
					previousEnemyField,
					enemyField,
					previousEnemySupport,
					enemySupport,
					previousEnemyGrave,
					currentEnemyGrave,
					previousEnemyBanished,
					currentEnemyBanished
				);
				queueLanePileFlights("you-field", myBoardCardsToPiles.field);
				queueLanePileFlights("you-support", myBoardCardsToPiles.support);
				queueLanePileFlights("ai-field", enemyBoardCardsToPiles.field);
				queueLanePileFlights("ai-support", enemyBoardCardsToPiles.support);
				const myShadowPenalty = hasShadowPenaltyForPlayer(my, currentMyLeader, currentMyEnv, enemyEnv);
				const enemyShadowPenalty = hasShadowPenaltyForPlayer(enemy, currentEnemyLeader, enemyEnv, currentMyEnv);
				const enemyHandCount = Number(enemy?.hand?.length ?? 0);
				const myTurn = !isSpectator && String(state?.game?.turnSlot || "") === slot;
				const phase = String(state?.game?.phase || "");
				if (phase !== currentPhase) {
					resetBoardAttackSelection();
					cancelBoardAttackSelection();
					animatePhaseChange(phase);
				}
				isMyTurn = myTurn;
				currentPhase = phase;
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
				if (myLeaderSlot) myLeaderSlot.onclick = null;
				const enemyLeaderSlot = document.getElementById("ai-leader");
				if (enemyLeaderSlot) {
					clearAttackTargetHover(enemyLeaderSlot as HTMLElement);
					enemyLeaderSlot.onclick = () => {
						if (!canSelectCombatTarget({ type: "leader", side: "ai" })) return;
						resolveSelectedBoardAttack({ type: "leader", side: "ai" });
					};
					if (canSelectCombatTarget({ type: "leader", side: "ai" })) {
						(enemyLeaderSlot as HTMLElement & { __attackHoverCleanup?: (() => void) | null }).__attackHoverCleanup = bindAttackTargetHover(enemyLeaderSlot);
					}
				}
				renderEnvSlot("you-env", currentMyEnv, true);
				renderEnvSlot("ai-env", enemyEnv, false);
				renderPileCounts("you", my);
				renderPileCounts("ai", enemy);
				const pileModal = document.getElementById("pileModal") as HTMLElement | null;
				if (pileModal && pileModal.style.display === "flex") renderPileModal();
				renderSideHand("aiHand", Array.from({ length: enemyHandCount }, (_, index) => `opp-${index}`), false);
				if (selectedHandCardId && !hand.includes(selectedHandCardId)) selectedHandCardId = null;
				if (selectedAttackerPos !== null && (selectedAttackerPos < 0 || selectedAttackerPos >= myField.length)) selectedAttackerPos = null;
				if (selectedTargetType === "ally" && (selectedTargetPos === null || selectedTargetPos >= enemyField.length)) {
					selectedTargetType = "leader";
					selectedTargetPos = null;
					if (view.selectedTargetEl) view.selectedTargetEl.textContent = "Líder inimigo";
				}
				renderHand(hand);
				renderMyField(myField, myFieldHp);
				renderMySupport(mySupport);
				renderEnemyField(enemyField, enemyFieldHp);
				renderEnemySupport(enemySupport);
				animateVisibleHandTransfers(
					myHandTransferSnapshots,
					"you",
					previousMyHand,
					hand,
					previousMyField,
					myField,
					previousMySupport,
					mySupport,
					previousMyEnv,
					currentMyEnv,
					previousMyGrave,
					currentMyGrave,
					previousMyBanished,
					currentMyBanished
				);
				animateHiddenHandTransfers(
					enemyHandTransferSnapshots,
					"ai",
					previousEnemyHand,
					previousHandCards.aiHand,
					previousEnemyField,
					enemyField,
					previousEnemySupport,
					enemySupport,
					null,
					enemyEnv,
					previousEnemyGrave,
					currentEnemyGrave,
					previousEnemyBanished,
					currentEnemyBanished
				);
				animateBoardPileTransfers(
					boardTransferSnapshots,
					"you-field",
					"you-support",
					previousMyField,
					myField,
					previousMySupport,
					mySupport,
					previousMyGrave,
					currentMyGrave,
					previousMyBanished,
					currentMyBanished,
					document.querySelector("#you-grave > .deckVisualCard:last-of-type") || document.getElementById("you-grave"),
					document.querySelector("#you-banished > .deckVisualCard:last-of-type") || document.getElementById("you-banished")
				);
				animateBoardPileTransfers(
					boardTransferSnapshots,
					"ai-field",
					"ai-support",
					previousEnemyField,
					enemyField,
					previousEnemySupport,
					enemySupport,
					previousEnemyGrave,
					currentEnemyGrave,
					previousEnemyBanished,
					currentEnemyBanished,
					document.querySelector("#ai-grave > .deckVisualCard:last-of-type") || document.getElementById("ai-grave"),
					document.querySelector("#ai-banished > .deckVisualCard:last-of-type") || document.getElementById("ai-banished")
				);
				animateFieldDamage("you", previousMyField, myField, previousMyFieldHp, myFieldHp);
				animateFieldDamage("ai", previousEnemyField, enemyField, previousEnemyFieldHp, enemyFieldHp);
				animateLeaderDamage("you-leader", previousMyLeader, currentMyLeader, previousMyLeaderHp, currentMyLeaderHp);
				animateLeaderDamage("ai-leader", previousEnemyLeader, currentEnemyLeader, previousEnemyLeaderHp, currentEnemyLeaderHp);
				setInspector(hoveredInspectorView || selectedInspectorView || (selectedHandCardId ? { cardId: selectedHandCardId, side: "you", lane: "hand" } : null));
				if (view.btnPlay) view.btnPlay.disabled = isSpectator || !(myTurn && phase === "PREP" && !!selectedHandCardId);
				if (view.btnLeaderPower) {
					const showLeaderPower = hasManualLeaderPower(currentMyLeader);
					const leaderPowerReady = showLeaderPower && canUseLeaderPower();
					view.btnLeaderPower.style.display = !isSpectator && showLeaderPower ? "" : "none";
					view.btnLeaderPower.disabled = !leaderPowerReady;
					view.btnLeaderPower.classList.toggle("is-ready", leaderPowerReady);
				}
				if (view.btnAttack) view.btnAttack.disabled = isSpectator || !(myTurn && phase === "COMBAT" && selectedAttackerPos !== null);
				if (view.btnTargetLeader) view.btnTargetLeader.disabled = isSpectator || !(myTurn && phase === "COMBAT");
				if (view.btnNextPhase) view.btnNextPhase.disabled = isSpectator || !myTurn;
				if (view.btnEndTurn) view.btnEndTurn.disabled = isSpectator || !(myTurn && phase === "END");
			}
		});
		log("JOINED", { roomId });
		if (isSpectator) {
			logText("Modo espectador ativo. Mãos e decks ficam ocultos; cemitério e banidas são públicos.");
		}
	} finally {
		isJoining = false;
	}
}

if (view.btnJoin) view.btnJoin.onclick = () => void joinMatch();
if (view.btnPlay) view.btnPlay.onclick = () => !isSpectator && selectedHandCardId && tryPlayCard(selectedHandCardId);
if (view.btnLeaderPower) view.btnLeaderPower.onclick = () => {
	if (isSpectator) return;
	if (!canUseLeaderPower()) return;
	animateChosenPowerActivation("you");
	room?.send("leader_power");
};
if (view.btnAttack) view.btnAttack.onclick = () => {
	if (isSpectator) return;
	if (!isMyTurn || currentPhase !== "COMBAT") return;
	if (selectedAttackerPos === null) return;
	if (selectedTargetType === "ally" && selectedTargetPos !== null) return resolveSelectedBoardAttack({ type: "ally", side: "ai", index: selectedTargetPos });
	resolveSelectedBoardAttack({ type: "leader", side: "ai" });
};
if (view.btnTargetLeader) view.btnTargetLeader.onclick = () => {
	if (isSpectator) return;
	if (!isMyTurn || currentPhase !== "COMBAT") return;
	selectedTargetType = "leader";
	selectedTargetPos = null;
	if (view.selectedTargetEl) view.selectedTargetEl.textContent = "Líder inimigo";
};
if (view.btnNextPhase) view.btnNextPhase.onclick = () => !isSpectator && room?.send("next_phase");
if (view.btnEndTurn) view.btnEndTurn.onclick = () => !isSpectator && room?.send("end_turn");
if (view.btnBackLobby) view.btnBackLobby.onclick = goLobby;

const logModal = document.getElementById("logModal") as HTMLElement | null;
const btnOpenLog = document.getElementById("btnOpenLog") as HTMLButtonElement | null;
const btnCloseLogModal = document.getElementById("btnCloseLogModal") as HTMLButtonElement | null;

function hideLogModal() {
	if (!logModal) return;
	logModal.style.display = "none";
}

function showLogModal() {
	if (!logModal) return;
	logModal.style.display = "flex";
}

if (btnOpenLog) btnOpenLog.onclick = showLogModal;
if (btnCloseLogModal) btnCloseLogModal.onclick = hideLogModal;
if (logModal) {
	logModal.addEventListener("click", (event) => {
		if (event.target === logModal) hideLogModal();
	});
}
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape") hideLogModal();
});

(window as any).hideCardChoice = () => hideCardChoiceModal(true);
(window as any).hidePile = () => hidePile();
(window as any).hideVictory = hideVictory;
bindPileSlots();

const params = new URLSearchParams(window.location.search);
if (view.endpointEl) view.endpointEl.value = resolveServerEndpoint(window.location.search);
if (view.roomIdEl) view.roomIdEl.value = params.get("roomId")?.trim() || "";
if (view.roomIdEl?.value) void joinMatch();
