import { fallbackDeck } from "./cardCatalog";

export function shuffle<T>(arr: T[]) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
}

export function drawToHand(deck: string[], hand: { push: (v: string) => any }, count: number) {
	for (let i = 0; i < count; i++) {
		const c = deck.pop();
		if (!c) break;
		hand.push(c);
	}
}

export function buildDeckFromId(deckId: string) {
	void deckId;
	return fallbackDeck();
}

