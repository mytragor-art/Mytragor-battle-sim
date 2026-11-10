export function layoutEquipment(side: "you" | "ai", cards: readonly string[], attachments: readonly number[], isEquipment: (cardId: string) => boolean): void {
	const zone = document.getElementById(`${side}-support`);
	const mainArea = zone?.closest<HTMLElement>(".mainArea");
	if (!zone || !mainArea) return;

	const depths = new Map<number, number>();
	let hasLooseSupport = false;
	for (const [index, slot] of Array.from(zone.children).entries()) {
		if (!(slot instanceof HTMLElement)) continue;
		const cardId = cards[index] || "";
		const target = attachments[index];
		const carrier = target === -1
			? document.getElementById(`${side}-leader`)
			: Number.isInteger(target) && target >= 0 && target < 5
				? document.getElementById(`${side}-ally-${target}`)
				: null;
		const attached = !!cardId && isEquipment(cardId) && !!carrier?.querySelector(":scope > .card");
		slot.classList.toggle("attachedEquipment", attached);
		slot.classList.toggle("emptySupport", !cardId);
		slot.style.removeProperty("--equipment-column");
		slot.style.removeProperty("--equipment-layer");
		delete slot.dataset.equipmentName;
		if (!attached) {
			hasLooseSupport ||= !!cardId;
			continue;
		}
		const depth = (depths.get(target) || 0) + 1;
		depths.set(target, depth);
		slot.style.setProperty("--equipment-column", String(target + 1));
		slot.style.setProperty("--equipment-layer", String(depth));
		slot.dataset.equipmentName = slot.querySelector<HTMLImageElement>(".slotCardImg")?.alt || cardId;
	}
	zone.classList.toggle("hasLooseSupport", hasLooseSupport);
	mainArea.style.setProperty("--equipment-depth", String(Math.max(0, ...depths.values())));
}
