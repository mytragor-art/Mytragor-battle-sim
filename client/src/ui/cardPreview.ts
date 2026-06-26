type MobilePreviewCard = {
  cardId: string;
  name: string;
  imageSrc: string;
  text: string;
};

type MobilePreviewApi = {
  updateCard: (card: MobilePreviewCard | null) => void;
  openSheet: (card?: MobilePreviewCard | null) => void;
  closeSheet: () => void;
  bindCardGesture: (element: HTMLElement, getCard: () => MobilePreviewCard | null) => void;
  cleanupTouchFocus: () => void;
};

function isMobileCoarse(): boolean {
  return window.matchMedia("(max-width: 980px)").matches && window.matchMedia("(pointer: coarse)").matches;
}

export function createMobileCardPreview(): MobilePreviewApi {
  const root = document.body;
  const peek = document.createElement("div");
  peek.className = "mobileCardPeek";
  peek.hidden = true;

  const peekImage = document.createElement("img");
  peekImage.alt = "Carta selecionada";
  const peekInfo = document.createElement("div");
  peekInfo.className = "cardInfo";
  const peekName = document.createElement("div");
  peekName.className = "cardName";
  const peekText = document.createElement("div");
  peekText.className = "cardText";
  peekInfo.append(peekName, peekText);
  const peekButton = document.createElement("button");
  peekButton.type = "button";
  peekButton.className = "btn primary viewButton";
  peekButton.textContent = "VER";
  peek.append(peekImage, peekInfo, peekButton);

  const rotateHint = document.createElement("div");
  rotateHint.className = "rotateHint";
  rotateHint.textContent = "Para melhor jogabilidade, gire o celular.";

  const backdrop = document.createElement("div");
  backdrop.className = "mobileCardSheetBackdrop";
  backdrop.hidden = true;

  const sheet = document.createElement("div");
  sheet.className = "mobileCardSheet";
  sheet.hidden = true;

  const sheetHeader = document.createElement("div");
  sheetHeader.className = "mobileCardSheetHeader";
  const sheetTitle = document.createElement("div");
  sheetTitle.className = "mobileCardSheetHeaderTitle";
  const sheetClose = document.createElement("button");
  sheetClose.type = "button";
  sheetClose.className = "mobileCardSheetClose";
  sheetClose.setAttribute("aria-label", "Fechar preview da carta");
  sheetClose.textContent = "×";
  sheetHeader.append(sheetTitle, sheetClose);

  const sheetContent = document.createElement("div");
  sheetContent.className = "mobileCardSheetContent";
  const sheetImage = document.createElement("img");
  sheetImage.className = "mobileCardSheetImage";
  sheetImage.alt = "Carta";
  const sheetText = document.createElement("div");
  sheetText.className = "mobileCardSheetText";
  sheetContent.append(sheetImage, sheetText);

  sheet.append(sheetHeader, sheetContent);

  root.append(peek, rotateHint, backdrop, sheet);

  let activeCard: MobilePreviewCard | null = null;
  let focusedCardElement: HTMLElement | null = null;

  const clearTouchFocus = () => {
    if (!focusedCardElement) return;
    focusedCardElement.classList.remove("touchFocus");
    focusedCardElement = null;
  };

  const hidePeek = () => {
    peek.hidden = true;
  };

  const showPeek = () => {
    if (!isMobileCoarse() || !activeCard || !sheet.hidden) return;
    peek.hidden = false;
  };

  const renderCard = () => {
    if (!activeCard) return;
    peekImage.src = activeCard.imageSrc;
    peekName.textContent = activeCard.name;
    peekText.textContent = activeCard.text;

    sheetTitle.textContent = activeCard.name;
    sheetImage.src = activeCard.imageSrc;
    sheetText.textContent = activeCard.text;
  };

  const closeSheet = () => {
    backdrop.hidden = true;
    sheet.hidden = true;
    if (activeCard && isMobileCoarse()) showPeek();
  };

  const openSheet = (card?: MobilePreviewCard | null) => {
    if (card) activeCard = card;
    if (!isMobileCoarse() || !activeCard) return;
    renderCard();
    hidePeek();
    backdrop.hidden = false;
    sheet.hidden = false;
  };

  const updateCard = (card: MobilePreviewCard | null) => {
    if (!isMobileCoarse()) {
      hidePeek();
      closeSheet();
      return;
    }
    activeCard = card;
    if (!card) {
      hidePeek();
      closeSheet();
      return;
    }
    renderCard();
    showPeek();
  };

  peekButton.addEventListener("click", () => openSheet());
  sheetClose.addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
  });

  window.addEventListener("resize", () => {
    if (!isMobileCoarse()) {
      hidePeek();
      closeSheet();
      clearTouchFocus();
      return;
    }
    if (!sheet.hidden) return;
    if (activeCard) showPeek();
  });

  const bindCardGesture = (element: HTMLElement, getCard: () => MobilePreviewCard | null) => {
    let holdTimer: number | null = null;
    let longPressed = false;
    let lastTapAt = 0;

    const clearHold = () => {
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    element.addEventListener("pointerdown", (event) => {
      if (!isMobileCoarse()) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      longPressed = false;
      clearHold();
      holdTimer = window.setTimeout(() => {
        longPressed = true;
        const card = getCard();
        if (!card) return;
        updateCard(card);
        openSheet(card);
        try {
          window.navigator.vibrate?.(12);
        } catch {
          // Ignore unsupported vibration APIs.
        }
      }, 450);
    }, { passive: true });

    element.addEventListener("pointerup", () => {
      clearHold();
    }, { passive: true });

    element.addEventListener("pointercancel", () => {
      clearHold();
    }, { passive: true });

    element.addEventListener("pointermove", clearHold, { passive: true });

    element.addEventListener("dblclick", () => {
      if (!isMobileCoarse()) return;
      const card = getCard();
      if (!card) return;
      updateCard(card);
      openSheet(card);
    });

    element.addEventListener("click", (event) => {
      if (!isMobileCoarse()) return;
      const card = getCard();
      if (!card) return;
      if (longPressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        longPressed = false;
        return;
      }
      const now = Date.now();
      const isDoubleTap = now - lastTapAt < 260;
      lastTapAt = now;

      clearTouchFocus();
      focusedCardElement = element;
      focusedCardElement.classList.add("touchFocus");
      updateCard(card);
      if (isDoubleTap) openSheet(card);
    }, true);
  };

  return {
    updateCard,
    openSheet,
    closeSheet,
    bindCardGesture,
    cleanupTouchFocus: clearTouchFocus
  };
}
