const keywordLabels: Record<string, string> = {
	bloquear: "Interpor",
	provocar: "Desafio",
};

function normalizeKeyword(text: string): string {
	return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function appendFormattedRulesText(element: HTMLElement, text: string, keywords: string[]): void {
	const keywordPattern = /(^|\n)([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{0,40}?)(\s*[—–-]\s*)/g;
	const labels = new Set(keywords.map((keyword) => normalizeKeyword(keywordLabels[normalizeKeyword(keyword)] || keyword)));
	let lastIndex = 0;

	for (const match of text.matchAll(keywordPattern)) {
		const matchIndex = match.index ?? 0;
		element.append(document.createTextNode(text.slice(lastIndex, matchIndex)), document.createTextNode(match[1]));
		if (labels.has(normalizeKeyword(match[2]))) {
			const keyword = document.createElement("span");
			keyword.className = "cardRulesKeyword";
			keyword.textContent = match[2].trim();
			element.append(keyword, document.createTextNode(match[3]));
		} else {
			element.appendChild(document.createTextNode(match[2] + match[3]));
		}
		lastIndex = matchIndex + match[0].length;
	}

	element.appendChild(document.createTextNode(text.slice(lastIndex)));
}

export function renderCardRulesText(element: HTMLElement, text: string, formatEffects = false, isChoiceOne = false, keywords: string[] = []): void {
	const rulesText = String(text || "").trim();
	element.replaceChildren();
	if (!formatEffects) {
		appendFormattedRulesText(element, rulesText || "Sem texto de efeito.", keywords);
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