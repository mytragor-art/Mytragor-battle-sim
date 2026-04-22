/* Responsibility: read deck data from localStorage for lobby UI. */

export type SavedDeck = {
	id: string;
	deckName: string;
	leaderName: string;
	leaderKey?: string;
	leaderImg?: string;
	fragImg?: string;
	tags?: string[];
	remoteId?: string;
	cards: string[];
};

const LOCAL_DECKS_KEY = "mytragor_decks";
const PLAY_DECK_KEY = "mytragor_play_deck";

function normalizeCards(cards: unknown): string[] {
	if (!Array.isArray(cards)) return [];
	return cards
		.map((card) => {
			if (typeof card === "string") return card;
			if (card && typeof card === "object") {
				const record = card as Record<string, unknown>;
				return String(record.name || record.id || record.cardId || "").trim();
			}
			return String(card || "").trim();
		})
		.filter(Boolean);
}

function normalizeSavedDeck(input: unknown, index: number): SavedDeck {
	const deck = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const remoteId = String(deck._id || "").trim();
	const id = String(deck.deckId || deck.id || remoteId || `local_${index}`);
	const leaderName = String(deck.leaderName || deck.leader || deck.leaderId || "").trim();
	const deckName = String(deck.deckName || leaderName || `Deck ${index + 1}`).trim();
	const cards = normalizeCards(deck.cards);
	return {
		id,
		deckName,
		leaderName,
		leaderKey: String(deck.leaderKey || "").trim(),
		leaderImg: String(deck.leaderImg || "").trim(),
		fragImg: String(deck.fragImg || "").trim(),
		tags: Array.isArray(deck.tags) ? deck.tags.map((tag) => String(tag)) : [],
		remoteId: remoteId || undefined,
		cards
	};
}

function isPlayableDeck(deck: SavedDeck): boolean {
	return Boolean(deck.leaderName && deck.cards.length > 0);
}

function normalizeDeckList(input: unknown): SavedDeck[] {
	if (!Array.isArray(input)) return [];
	return input.map((deck, index) => normalizeSavedDeck(deck, index)).filter(isPlayableDeck);
}

function readDecksFromLocalStorage(): SavedDeck[] {
	const raw = localStorage.getItem(LOCAL_DECKS_KEY);
	if (!raw) return [];
	return normalizeDeckList(JSON.parse(raw));
}

function readPlayDeck(): SavedDeck[] {
	const playDeckRaw = localStorage.getItem(PLAY_DECK_KEY);
	if (!playDeckRaw) return [];
	const deck = JSON.parse(playDeckRaw);
	const cards = normalizeCards(deck?.cards);
	const leaderName = String(deck?.leader || deck?.leaderName || deck?.leaderId || "").trim();
	if (!leaderName || cards.length === 0) return [];
	return [{
		id: String(deck?.deckId || deck?.id || "play_deck"),
		deckName: String(deck?.deckName || "Deck de Teste"),
		leaderName,
		leaderKey: String(deck?.leaderKey || "").trim(),
		leaderImg: String(deck?.leaderImg || "").trim(),
		fragImg: String(deck?.fragImg || "").trim(),
		cards
	}];
}

function deckFingerprint(deck: SavedDeck): string {
	return JSON.stringify([deck.deckName, deck.leaderName, deck.cards]);
}

function mergeDeckLists(primary: SavedDeck[], secondary: SavedDeck[]): SavedDeck[] {
	const merged: SavedDeck[] = [];
	const seen = new Set<string>();
	for (const deck of [...primary, ...secondary]) {
		const fingerprint = deck.id || deckFingerprint(deck);
		if (seen.has(fingerprint)) continue;
		seen.add(fingerprint);
		merged.push(deck);
	}
	return merged;
}

function cacheDecksForLobby(decks: SavedDeck[]) {
	try {
		localStorage.setItem(
			LOCAL_DECKS_KEY,
			JSON.stringify(decks.map((deck) => ({
				_id: deck.remoteId,
				id: deck.id,
				deckId: deck.id,
				deckName: deck.deckName,
				leader: deck.leaderName,
				leaderName: deck.leaderName,
				leaderKey: deck.leaderKey || "",
				leaderImg: deck.leaderImg || "",
				fragImg: deck.fragImg || "",
				tags: Array.isArray(deck.tags) ? deck.tags : [],
				cards: deck.cards
			})))
		);
	} catch {
		// ignore storage write failures
	}
	return decks;
}

async function readRemoteDecks(): Promise<SavedDeck[]> {
	const runtime = window as Window & {
		FIREBASE_CONFIG?: unknown;
		_mytragor_firebase_init_local?: boolean;
		firebase?: {
			initializeApp?: (config: unknown) => unknown;
			auth?: () => { currentUser?: { uid?: string } | null };
			firestore?: () => {
				collection: (name: string) => {
					doc: (id: string) => {
						collection: (child: string) => {
							get: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>;
						};
					};
				};
			};
		};
	};

	try {
		if (!runtime.firebase) return [];
		if (!runtime._mytragor_firebase_init_local && runtime.FIREBASE_CONFIG && runtime.firebase.initializeApp) {
			runtime.firebase.initializeApp(runtime.FIREBASE_CONFIG);
			runtime._mytragor_firebase_init_local = true;
		}
		if (!runtime.firebase.auth || !runtime.firebase.firestore) return [];
		const user = runtime.firebase.auth().currentUser;
		if (!user?.uid) return [];
		const snap = await runtime.firebase.firestore().collection("users").doc(user.uid).collection("decks").get();
		return normalizeDeckList(snap.docs.map((doc) => ({ _id: doc.id, ...(doc.data() as Record<string, unknown> || {}) })));
	} catch {
		return [];
	}
}

export function readSavedDecks(): SavedDeck[] {
	try {
		const decks = readDecksFromLocalStorage();
		if (decks.length) return decks;
		return readPlayDeck();
	} catch {
		return [];
	}
	return [];
}

export async function hydrateSavedDecks(): Promise<SavedDeck[]> {
	const localDecks = readSavedDecks();
	const remoteDecks = await readRemoteDecks();
	if (!remoteDecks.length) return localDecks;
	return cacheDecksForLobby(mergeDeckLists(remoteDecks, localDecks));
}
