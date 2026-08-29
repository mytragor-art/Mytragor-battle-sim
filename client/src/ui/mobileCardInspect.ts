import { renderCardRulesText } from "./cardRulesText";

export type MobileInspectCard = {
	cardId: string;
	title: string;
	imageSrc: string;
	typeLine?: string;
	filiationLine?: string;
	text?: string;
	formatEffects?: boolean;
	isChoiceOne?: boolean;
	keywords?: string[];
	stats?: string[];
};

type MobileCardInspectApi = {
	bind: (element: HTMLElement, getCard: () => MobileInspectCard | null) => void;
	showInfo: (card: MobileInspectCard | null) => void;
	showImage: (card?: MobileInspectCard | null) => void;
	hideAll: () => void;
};

const LONG_PRESS_MS = 650;
const MOVE_CANCEL_PX = 10;

function isMobileInspectEnabled(): boolean {
	return window.matchMedia("(max-width: 980px)").matches
		&& (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(any-pointer: coarse)").matches);
}

export function createMobileCardInspect(): MobileCardInspectApi {
	const backdrop = document.createElement("div");
	backdrop.className = "mobileInspectBackdrop";
	backdrop.hidden = true;

	const infoSheet = document.createElement("section");
	infoSheet.className = "mobileInspectSheet";
	infoSheet.hidden = true;
	infoSheet.setAttribute("aria-label", "Inspecao de carta");

	const header = document.createElement("div");
	header.className = "mobileInspectHeader";
	const titleWrap = document.createElement("div");
	titleWrap.className = "mobileInspectTitleWrap";
	const titleEl = document.createElement("h3");
	titleEl.className = "mobileInspectTitle";
	const typeEl = document.createElement("div");
	typeEl.className = "mobileInspectType";
	titleWrap.append(titleEl, typeEl);
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "mobileInspectClose";
	closeButton.setAttribute("aria-label", "Fechar inspeção da carta");
	closeButton.textContent = "×";
	header.append(titleWrap, closeButton);

	const body = document.createElement("div");
	body.className = "mobileInspectBody";
	const thumb = document.createElement("img");
	thumb.className = "mobileInspectThumb";
	thumb.alt = "Carta inspecionada";
	const content = document.createElement("div");
	content.className = "mobileInspectContent";
	const metaEl = document.createElement("div");
	metaEl.className = "mobileInspectMeta";
	const statsEl = document.createElement("div");
	statsEl.className = "mobileInspectStats";
	const textEl = document.createElement("div");
	textEl.className = "mobileInspectText";
	content.append(metaEl, statsEl, textEl);
	body.append(thumb, content);

	const actions = document.createElement("div");
	actions.className = "mobileInspectActions";
	const imageButton = document.createElement("button");
	imageButton.type = "button";
	imageButton.className = "btn primary mobileInspectAction";
	imageButton.innerHTML = "<span class=\"mobileInspectEye\" aria-hidden=\"true\">👁</span><span>Ver carta</span>";
	const dismissButton = document.createElement("button");
	dismissButton.type = "button";
	dismissButton.className = "btn mobileInspectAction";
	dismissButton.textContent = "Fechar";
	actions.append(imageButton, dismissButton);
	infoSheet.append(header, body, actions);

	const imageViewer = document.createElement("section");
	imageViewer.className = "mobileInspectViewer";
	imageViewer.hidden = true;
	imageViewer.setAttribute("aria-label", "Arte da carta");
	const viewerHeader = document.createElement("div");
	viewerHeader.className = "mobileInspectViewerHeader";
	const viewerTitle = document.createElement("div");
	viewerTitle.className = "mobileInspectViewerTitle";
	const closeImageButton = document.createElement("button");
	closeImageButton.type = "button";
	closeImageButton.className = "mobileInspectClose";
	closeImageButton.setAttribute("aria-label", "Fechar arte da carta");
	closeImageButton.textContent = "×";
	viewerHeader.append(viewerTitle, closeImageButton);
	const fullImage = document.createElement("img");
	fullImage.className = "mobileInspectViewerImage";
	fullImage.alt = "Arte ampliada da carta";
	imageViewer.append(viewerHeader, fullImage);

	document.body.append(backdrop, infoSheet, imageViewer);

	let activeCard: MobileInspectCard | null = null;

	const hideInfoOnly = () => {
		infoSheet.hidden = true;
		if (imageViewer.hidden) backdrop.hidden = true;
	};

	const hideImageOnly = () => {
		imageViewer.hidden = true;
		if (infoSheet.hidden) backdrop.hidden = true;
	};

	const hideAll = () => {
		hideImageOnly();
		hideInfoOnly();
	};

	const renderCard = (card: MobileInspectCard) => {
		titleEl.textContent = card.title || card.cardId;
		typeEl.textContent = card.typeLine || "";
		thumb.src = card.imageSrc;
		thumb.alt = card.title || card.cardId || "Carta";
		fullImage.src = card.imageSrc;
		fullImage.alt = card.title || card.cardId || "Carta";
		viewerTitle.textContent = card.title || card.cardId;
		metaEl.innerHTML = "";
		statsEl.innerHTML = "";
		renderCardRulesText(textEl, String(card.text || ""), card.formatEffects, card.isChoiceOne, card.keywords);

		if (card.filiationLine) {
			const pill = document.createElement("div");
			pill.className = "mobileInspectMetaPill";
			pill.textContent = card.filiationLine;
			metaEl.appendChild(pill);
		}

		for (const stat of card.stats || []) {
			const pill = document.createElement("div");
			pill.className = "mobileInspectStatPill";
			pill.textContent = stat;
			statsEl.appendChild(pill);
		}
	};

	const showInfo = (card: MobileInspectCard | null) => {
		activeCard = card;
		if (!isMobileInspectEnabled() || !card) {
			hideAll();
			return;
		}
		renderCard(card);
		imageViewer.hidden = true;
		backdrop.hidden = false;
		infoSheet.hidden = false;
	};

	const showImage = (card?: MobileInspectCard | null) => {
		if (card) activeCard = card;
		if (!isMobileInspectEnabled() || !activeCard) return;
		renderCard(activeCard);
		backdrop.hidden = false;
		imageViewer.hidden = false;
	};

	backdrop.addEventListener("click", () => {
		if (!imageViewer.hidden) {
			hideImageOnly();
			return;
		}
		hideAll();
	});
	closeButton.addEventListener("click", hideAll);
	dismissButton.addEventListener("click", hideAll);
	imageButton.addEventListener("click", () => showImage());
	closeImageButton.addEventListener("click", hideImageOnly);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hideAll();
	});
	window.addEventListener("resize", () => {
		if (!isMobileInspectEnabled()) hideAll();
	});

	const bind = (element: HTMLElement, getCard: () => MobileInspectCard | null) => {
		let pointerId: number | null = null;
		let touchIdentifier: number | null = null;
		let startX = 0;
		let startY = 0;
		let holdTimer: number | null = null;
		let suppressNextClick = false;

		const clearHold = () => {
			if (holdTimer !== null) {
				window.clearTimeout(holdTimer);
				holdTimer = null;
			}
		};

		const triggerInspect = () => {
			const card = getCard();
			if (!card) return;
			suppressNextClick = true;
			showInfo(card);
			try {
				window.navigator.vibrate?.(16);
			} catch {
				// Ignore unsupported vibration APIs.
			}
		};

		const scheduleHold = () => {
			clearHold();
			holdTimer = window.setTimeout(triggerInspect, LONG_PRESS_MS);
		};

		const cancelTracking = () => {
			clearHold();
			pointerId = null;
			touchIdentifier = null;
		};

		element.addEventListener("pointerdown", (event) => {
			if (!isMobileInspectEnabled()) return;
			if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
			if (event.button !== 0) return;
			pointerId = event.pointerId;
			startX = event.clientX;
			startY = event.clientY;
			suppressNextClick = false;
			scheduleHold();
		}, { passive: true });

		element.addEventListener("pointermove", (event) => {
			if (pointerId !== event.pointerId) return;
			if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) cancelTracking();
		}, { passive: true });

		element.addEventListener("pointerup", (event) => {
			if (pointerId !== event.pointerId) return;
			clearHold();
			pointerId = null;
		});

		element.addEventListener("pointercancel", (event) => {
			if (pointerId !== event.pointerId) return;
			cancelTracking();
		});

		element.addEventListener("touchstart", (event) => {
			if (!isMobileInspectEnabled()) return;
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			touchIdentifier = touch.identifier;
			startX = touch.clientX;
			startY = touch.clientY;
			suppressNextClick = false;
			scheduleHold();
		}, { passive: true });

		element.addEventListener("touchmove", (event) => {
			if (touchIdentifier === null) return;
			const touch = Array.from(event.touches).find((entry) => entry.identifier === touchIdentifier);
			if (!touch) {
				cancelTracking();
				return;
			}
			if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > MOVE_CANCEL_PX) cancelTracking();
		}, { passive: true });

		element.addEventListener("touchend", () => {
			clearHold();
			touchIdentifier = null;
		}, { passive: true });

		element.addEventListener("touchcancel", cancelTracking, { passive: true });

		element.addEventListener("contextmenu", (event) => {
			if (!isMobileInspectEnabled()) return;
			event.preventDefault();
		});

		element.addEventListener("click", (event) => {
			if (!suppressNextClick) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			suppressNextClick = false;
		}, true);
	};

	return { bind, showInfo, showImage, hideAll };
}
