export function setupArenaSlots() {
	const fillZone = (id: string, count: number, labelBase: string, big = false, slotClass = "cardSlot") => {
		const zone = document.getElementById(id);
		if (!zone || zone.children.length > 0) return;

		const fragment = document.createDocumentFragment();
		for (let index = 0; index < count; index += 1) {
			const slot = document.createElement("div");
			slot.className = big ? `${slotClass} big` : slotClass;
			slot.dataset.slot = `${labelBase} ${index + 1}`;
			fragment.appendChild(slot);
		}
		zone.appendChild(fragment);
	};

	fillZone("ai-field", 5, "Oponente Campo", false, "slot");
	fillZone("ai-support", 5, "Oponente Suporte", false, "slot");
	fillZone("enemyLeaders", 2, "Oponente Extra", true);
	fillZone("youLeaders", 2, "Seu Extra", true);
	fillZone("you-support", 5, "Seu Suporte", false, "slot");
	fillZone("you-field", 5, "Seu Campo", false, "slot");
}
