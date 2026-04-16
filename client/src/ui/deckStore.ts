/* Responsibility: read deck data from localStorage for lobby UI. */

export type SavedDeck = {
	id: string;
	deckName: string;
	leaderName: string;
	cards: string[];
};

export function readSavedDecks(): SavedDeck[] {
	try {
		const raw = localStorage.getItem("mytragor_decks");
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				const decks = parsed
					.map((d: any, index: number) => ({
						id: String(d?._id || d?.deckId || `local_${index}`),
						deckName: String(d?.deckName || d?.leaderName || d?.leader || `Deck ${index + 1}`),
						leaderName: String(d?.leaderName || d?.leader || ""),
						cards: Array.isArray(d?.cards) ? d.cards.map((c: any) => String(c)) : []
					}))
					.filter((d: SavedDeck) => d.leaderName && d.cards.length > 0);
				if (decks.length) return decks;
			}
		}

		const playDeckRaw = localStorage.getItem("mytragor_play_deck");
		if (playDeckRaw) {
			const d = JSON.parse(playDeckRaw);
			const cards = Array.isArray(d?.cards) ? d.cards.map((c: any) => String(c)) : [];
			const leaderName = String(d?.leader || d?.leaderName || "");
			if (leaderName && cards.length > 0) {
				return [{ id: "play_deck", deckName: String(d?.deckName || "Deck de Teste"), leaderName, cards }];
			}
		}
	} catch {
		return [];
	}
	return [];
}
