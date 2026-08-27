export function renderCardRulesText(element: HTMLElement, text: string, formatEffects = false, isChoiceOne = false): void {
	const rulesText = String(text || "").trim();
	element.replaceChildren();
	if (!formatEffects) {
		element.textContent = rulesText || "Sem texto de efeito.";
		return;
	}

	const parts = rulesText.split(/\s*•\s*/).filter(Boolean);
	if (isChoiceOne) {
		const header = document.createElement("strong");
		header.className = "cardRulesChoiceHeader";
		header.textContent = parts.shift() || "Escolha 1:";
		element.appendChild(header);
	}

	for (const effect of parts) {
		const line = document.createElement("span");
		line.className = "cardRulesChoiceOption";
		const universalRule = "Desloque esta carta após resolver.";
		const [choiceEffect, universalEffect] = effect.split(universalRule);
		line.textContent = `• ${choiceEffect.trim()}`;
		element.appendChild(line);
		if (universalEffect !== undefined) {
			const rule = document.createElement("span");
			rule.className = "cardRulesUniversalRule";
			rule.textContent = universalRule;
			element.appendChild(rule);
		}
	}
}