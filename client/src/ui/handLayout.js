export function layoutOpponentHand(container) {
    const cards = Array.from(container.querySelectorAll(":scope > .handCard"));
    const style = getComputedStyle(container);
    const availableWidth = Math.max(0, container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const cardWidth = cards[0]?.offsetWidth || 0;
    const requiredOverlap = cards.length > 1
        ? (cards.length * cardWidth - availableWidth) / (cards.length - 1)
        : 0;
    const overlap = cards.length > 1
        ? Math.min(Math.max(0, cardWidth - 8), Math.max(cardWidth * 0.18, requiredOverlap))
        : 0;
    container.style.setProperty("--opponent-hand-overlap", `${overlap}px`);
    container.classList.remove("handStacked");
    container.style.removeProperty("--hand-overlap");
}
export function layoutPlayerHand(container) {
    const cards = Array.from(container.querySelectorAll(":scope > .handCard"));
    container.style.setProperty("--player-hand-count", String(cards.length));
    const style = getComputedStyle(container);
    const availableWidth = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const cardWidth = cards[0]?.offsetWidth || 0;
    const scale = container.offsetWidth ? container.getBoundingClientRect().width / container.offsetWidth : 1;
    const gap = parseFloat(style.columnGap) || 0;
    const minimumExposedWidth = (window.matchMedia("(pointer: coarse)").matches ? 44 : 36) / (scale || 1);
    const maxOverlap = Math.max(0, cardWidth - minimumExposedWidth);
    const requiredOverlap = cards.length > 1
        ? (cards.length * cardWidth + (cards.length - 1) * gap - availableWidth) / (cards.length - 1)
        : 0;
    const overlap = cards.length > 1
        ? Math.min(maxOverlap, Math.max(cardWidth * 0.16 + gap, requiredOverlap))
        : 0;
    container.style.setProperty("--player-hand-overlap", `${overlap}px`);
    cards.forEach((card, index) => {
        const offset = (index - (cards.length - 1) / 2) / Math.max((cards.length - 1) / 2, 1);
        card.style.setProperty("--player-hand-order", String(index));
        card.style.setProperty("--player-hand-angle", `${offset * 4}deg`);
        card.style.setProperty("--player-hand-arc", `${offset * offset * 8}px`);
    });
    const fragments = container.closest("#arenaCol")?.querySelector("#you-fragsDock");
    if (cards.length && fragments && scale > 0 && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        const handRect = container.getBoundingClientRect();
        const fragmentRect = fragments.getBoundingClientRect();
        const allowedOverlap = Math.min(20, fragmentRect.height * 0.25);
        const rest = (fragmentRect.bottom - allowedOverlap - handRect.top) / scale - parseFloat(style.paddingTop);
        container.style.setProperty("--player-hand-rest", `${Math.min(cards[0].offsetHeight * 0.4, Math.max(0, rest))}px`);
    }
    else {
        container.style.removeProperty("--player-hand-rest");
    }
}
