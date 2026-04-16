type CardDef = {
	name: string;
	kind?: string;
	img?: string;
	cost?: number;
	classe?: string;
	tipo?: string;
	filiacao?: string;
	text?: string;
};

type LabCard = {
	id: string;
	def: CardDef;
};

const catalogGrid = document.getElementById("catalogGrid") as HTMLDivElement | null;
const handGrid = document.getElementById("handGrid") as HTMLDivElement | null;
const fieldGrid = document.getElementById("fieldGrid") as HTMLDivElement | null;
const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
const kindFilter = document.getElementById("kindFilter") as HTMLSelectElement | null;
const btnRefillHand = document.getElementById("btnRefillHand") as HTMLButtonElement | null;
const btnClearField = document.getElementById("btnClearField") as HTMLButtonElement | null;
const btnNextTurn = document.getElementById("btnNextTurn") as HTMLButtonElement | null;
const btnResetFragments = document.getElementById("btnResetFragments") as HTMLButtonElement | null;
const handCountEl = document.getElementById("handCount");
const fieldCountEl = document.getElementById("fieldCount");
const catalogCountEl = document.getElementById("catalogCount");
const p1FragmentCountEl = document.getElementById("p1FragmentCount");
const p2FragmentCountEl = document.getElementById("p2FragmentCount");
const fragmentMaxEl = document.getElementById("fragmentMax");
const fragmentMax2El = document.getElementById("fragmentMax2");
const turnCountEl = document.getElementById("turnCount");
const activePlayerEl = document.getElementById("activePlayer");
const labStatusEl = document.getElementById("labStatus");

const previewImg = document.getElementById("previewImg") as HTMLImageElement | null;
const previewName = document.getElementById("previewName");
const previewMeta = document.getElementById("previewMeta");
const previewText = document.getElementById("previewText");

const normalizedKind = (value: string | undefined): string => {
	const raw = String(value || "").trim().toLowerCase();
	if (!raw) return "outro";
	if (raw === "truque") return "trick";
	return raw;
};

const cardDefs = (window as Window & { CARD_DEFS?: CardDef[] }).CARD_DEFS;

const cards: LabCard[] = Array.isArray(cardDefs)
	? cardDefs.map((def: CardDef, index: number) => ({ id: `c-${index}`, def }))
	: [];

const hand: LabCard[] = [];
const field: LabCard[] = [];
const initialFragments = 0;
const maxFragments = 10;
let p1Fragments = initialFragments;
let p2Fragments = initialFragments;
let activePlayer: 1 | 2 = 1;
let turn = 0;

function gainPerTurn(player: 1 | 2): number {
	return player === 1 ? 1 : 2;
}

function getActiveFragments(): number {
	return activePlayer === 1 ? p1Fragments : p2Fragments;
}

function setActiveFragments(value: number): void {
	if (activePlayer === 1) {
		p1Fragments = value;
		return;
	}
	p2Fragments = value;
}

function withAssetsPath(imgPath: string | undefined): string {
	if (!imgPath) return "";
	if (imgPath.startsWith("http://") || imgPath.startsWith("https://") || imgPath.startsWith("/")) return imgPath;
	return `/${imgPath.replace(/^\.?\//, "")}`;
}

function cardMeta(card: CardDef): string {
	const kind = normalizedKind(card.kind);
	const parts = [`Tipo: ${kind}`];
	if (typeof card.cost === "number") parts.push(`Custo: ${card.cost}`);
	if (card.filiacao) parts.push(`Filiação: ${card.filiacao}`);
	if (card.classe) parts.push(`Classe: ${card.classe}`);
	if (card.tipo) parts.push(`Subtipo: ${card.tipo}`);
	return parts.join(" • ");
}

function cardSubclassLine(card: CardDef): string {
	return [String(card.classe || "").trim(), String(card.tipo || "").trim()].filter(Boolean).join(" • ");
}

function previewBody(card: CardDef): string {
	return [cardSubclassLine(card), String(card.text || "Sem texto de efeito.").trim()].filter(Boolean).join("\n");
}

function setPreview(card: LabCard | null): void {
	if (!card) {
		if (previewImg) previewImg.src = "";
		if (previewName) previewName.textContent = "Passe o mouse em uma carta";
		if (previewMeta) previewMeta.textContent = "";
		if (previewText) previewText.textContent = "";
		return;
	}
	if (previewImg) {
		previewImg.src = withAssetsPath(card.def.img);
		previewImg.alt = card.def.name;
	}
	if (previewName) previewName.textContent = card.def.name;
	if (previewMeta) previewMeta.textContent = cardMeta(card.def);
	if (previewText) previewText.textContent = previewBody(card.def);
}

function cardButton(card: LabCard, onClick: () => void): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cardsLabCard";

	const image = document.createElement("img");
	image.src = withAssetsPath(card.def.img);
	image.alt = card.def.name;

	const name = document.createElement("span");
	name.className = "cardsLabCardName";
	name.textContent = card.def.name;

	const meta = document.createElement("span");
	meta.className = "cardsLabCardMeta";
	meta.textContent = cardMeta(card.def);

	button.appendChild(image);
	button.appendChild(name);
	button.appendChild(meta);

	button.onclick = onClick;
	button.onmouseenter = () => setPreview(card);
	button.onfocus = () => setPreview(card);

	return button;
}

function randomHand(size: number): LabCard[] {
	const shuffled = [...cards].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, Math.min(size, shuffled.length));
}

function setStatus(message: string, kind: "ok" | "error" | "" = ""): void {
	if (!labStatusEl) return;
	labStatusEl.textContent = message;
	labStatusEl.classList.remove("ok", "error");
	if (kind) labStatusEl.classList.add(kind);
}

function syncCounts(): void {
	if (handCountEl) handCountEl.textContent = String(hand.length);
	if (fieldCountEl) fieldCountEl.textContent = String(field.length);
	if (p1FragmentCountEl) p1FragmentCountEl.textContent = String(p1Fragments);
	if (p2FragmentCountEl) p2FragmentCountEl.textContent = String(p2Fragments);
	if (fragmentMaxEl) fragmentMaxEl.textContent = String(maxFragments);
	if (fragmentMax2El) fragmentMax2El.textContent = String(maxFragments);
	if (turnCountEl) turnCountEl.textContent = String(turn);
	if (activePlayerEl) activePlayerEl.textContent = String(activePlayer);
}

function canPayCost(card: CardDef): boolean {
	const cost = typeof card.cost === "number" ? card.cost : 0;
	return getActiveFragments() >= cost;
}

function payCost(card: CardDef): void {
	const cost = typeof card.cost === "number" ? card.cost : 0;
	setActiveFragments(Math.max(0, getActiveFragments() - cost));
}

function renderHand(): void {
	if (!handGrid) return;
	handGrid.innerHTML = "";

	if (!hand.length) {
		const empty = document.createElement("div");
		empty.className = "cardsLabEmpty";
		empty.textContent = "Sem cartas na mão.";
		handGrid.appendChild(empty);
		return;
	}

	hand.forEach((card, index) => {
		handGrid.appendChild(cardButton(card, () => {
			if (field.length >= 5) {
				setStatus("Campo cheio (máx. 5).", "error");
				return;
			}
			if (!canPayCost(card.def)) {
				const cost = typeof card.def.cost === "number" ? card.def.cost : 0;
				setStatus(`J${activePlayer} sem fragmentos: custo ${cost}, tem ${getActiveFragments()}.`, "error");
				return;
			}
			payCost(card.def);
			hand.splice(index, 1);
			field.push(card);
			const cost = typeof card.def.cost === "number" ? card.def.cost : 0;
			setStatus(`J${activePlayer} jogou ${card.def.name} (custo ${cost}).`, "ok");
			syncCounts();
			renderHand();
			renderField();
		}));
	});
}

function renderField(): void {
	if (!fieldGrid) return;
	fieldGrid.innerHTML = "";

	if (!field.length) {
		const empty = document.createElement("div");
		empty.className = "cardsLabEmpty";
		empty.textContent = "Campo vazio.";
		fieldGrid.appendChild(empty);
		return;
	}

	field.forEach((card, index) => {
		fieldGrid.appendChild(cardButton(card, () => {
			field.splice(index, 1);
			hand.push(card);
			setStatus(`${card.def.name} voltou para a mão.`, "ok");
			syncCounts();
			renderHand();
			renderField();
		}));
	});
}

function renderCatalog(): void {
	if (!catalogGrid || !kindFilter) return;
	catalogGrid.innerHTML = "";

	const term = (searchInput?.value || "").trim().toLowerCase();
	const selectedKind = kindFilter.value;

	const filtered = cards.filter((entry) => {
		const byName = entry.def.name.toLowerCase().includes(term);
		const kind = normalizedKind(entry.def.kind);
		const byKind = selectedKind === "all" || selectedKind === kind;
		return byName && byKind;
	});

	if (catalogCountEl) catalogCountEl.textContent = String(filtered.length);

	if (!filtered.length) {
		const empty = document.createElement("div");
		empty.className = "cardsLabEmpty";
		empty.textContent = "Nenhuma carta encontrada para esse filtro.";
		catalogGrid.appendChild(empty);
		return;
	}

	filtered.forEach((card) => {
		catalogGrid.appendChild(cardButton(card, () => {
			hand.push(card);
			setStatus(`${card.def.name} adicionada à mão.`, "ok");
			syncCounts();
			renderHand();
		}));
	});
}

function setupFilters(): void {
	if (!kindFilter) return;
	kindFilter.innerHTML = "";

	const allOption = document.createElement("option");
	allOption.value = "all";
	allOption.textContent = "Todos os tipos";
	kindFilter.appendChild(allOption);

	const kinds = new Set(cards.map((card) => normalizedKind(card.def.kind)));
	Array.from(kinds)
		.sort((a, b) => a.localeCompare(b))
		.forEach((kind) => {
			const option = document.createElement("option");
			option.value = kind;
			option.textContent = kind;
			kindFilter.appendChild(option);
		});
}

function refillHand(): void {
	hand.splice(0, hand.length, ...randomHand(5));
	setStatus("Mão aleatória gerada.", "ok");
	syncCounts();
	renderHand();
}

function clearField(): void {
	if (!field.length) return;
	hand.push(...field);
	field.splice(0, field.length);
	setStatus("Campo limpo; cartas retornaram para a mão.", "ok");
	syncCounts();
	renderHand();
	renderField();
}

function resetFragments(): void {
	p1Fragments = initialFragments;
	p2Fragments = initialFragments;
	activePlayer = 1;
	turn = 0;
	startTurn();
	setStatus("Fragmentos resetados: ambos iniciam em 0; turno do J1 começa com +1.", "ok");
	syncCounts();
}

function startTurn(): void {
	turn += 1;
	const gain = gainPerTurn(activePlayer);
	setActiveFragments(Math.min(maxFragments, getActiveFragments() + gain));
	setStatus(`Turno ${turn}: J${activePlayer} ganhou +${gain} (${getActiveFragments()}/${maxFragments}).`, "ok");
	syncCounts();
}

function passTurn(): void {
	activePlayer = activePlayer === 1 ? 2 : 1;
	startTurn();
}

function boot(): void {
	setupFilters();
	renderCatalog();
	refillHand();
	renderField();
	syncCounts();

	searchInput?.addEventListener("input", renderCatalog);
	kindFilter?.addEventListener("change", renderCatalog);
	btnRefillHand?.addEventListener("click", refillHand);
	btnClearField?.addEventListener("click", clearField);
	btnNextTurn?.addEventListener("click", passTurn);
	btnResetFragments?.addEventListener("click", resetFragments);
	startTurn();
	setPreview(cards[0] || null);
}

boot();
