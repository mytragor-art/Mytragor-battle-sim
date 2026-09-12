/* Responsibility: read deck data from localStorage for lobby UI. */
const LOCAL_DECKS_KEY = "mytragor_decks";
const PLAY_DECK_KEY = "mytragor_play_deck";
const LEADER_ART_BY_KEY = {
    valbrak: "/chosens/layout-valbrak.ai.png",
    katsu: "/chosens/layout-katsuvingador.ai.png",
    leafae: "/chosens/layout-leafaefloresta.ai.png",
    ademais: "/chosens/layout-ademais.ai.png"
};
export function resolveDeckAssetPath(path, fallback = "/publicadas/ui/layout-background.ai.thumb.webp") {
    const assetPath = String(path || "").trim();
    if (!assetPath)
        return fallback;
    if (/^(?:https?:|data:|\/)/i.test(assetPath))
        return assetPath;
    return `/${assetPath.replace(/^(?:\.\.\/|\.\/)+/, "")}`;
}
export function resolveLeaderArtwork(deck) {
    if (deck.leaderImg)
        return resolveDeckAssetPath(deck.leaderImg);
    const leaderKey = `${deck.leaderKey || ""} ${deck.leaderName || ""}`.toLowerCase();
    const artwork = Object.entries(LEADER_ART_BY_KEY).find(([key]) => leaderKey.includes(key))?.[1];
    return artwork || "/publicadas/ui/layout-background.ai.thumb.webp";
}
function normalizeCards(cards) {
    if (!Array.isArray(cards))
        return [];
    return cards
        .map((card) => {
        if (typeof card === "string")
            return card;
        if (card && typeof card === "object") {
            const record = card;
            return String(record.name || record.id || record.cardId || "").trim();
        }
        return String(card || "").trim();
    })
        .filter(Boolean);
}
function normalizeSavedDeck(input, index) {
    const deck = (input && typeof input === "object" ? input : {});
    const remoteId = String(deck._id || "").trim();
    const id = String(deck.deckId || deck.id || remoteId || `local_${index}`);
    const leaderName = String(deck.leaderName || deck.leader || deck.leaderId || "").trim();
    const deckName = String(deck.deckName || leaderName || `Baralho ${index + 1}`).trim();
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
        accessories: deck.accessories && typeof deck.accessories === "object" ? {
            playmat: String(deck.accessories.playmat || "").trim() || undefined,
            sleeve: String(deck.accessories.sleeve || "").trim() || undefined
        } : undefined,
        cards
    };
}
function isPlayableDeck(deck) {
    return Boolean(deck.leaderName && deck.cards.length > 0);
}
function normalizeDeckList(input) {
    if (!Array.isArray(input))
        return [];
    return input.map((deck, index) => normalizeSavedDeck(deck, index)).filter(isPlayableDeck);
}
function readDecksFromLocalStorage() {
    const raw = localStorage.getItem(LOCAL_DECKS_KEY);
    if (!raw)
        return [];
    return normalizeDeckList(JSON.parse(raw));
}
function readPlayDeck() {
    const playDeckRaw = localStorage.getItem(PLAY_DECK_KEY);
    if (!playDeckRaw)
        return [];
    const deck = JSON.parse(playDeckRaw);
    const cards = normalizeCards(deck?.cards);
    const leaderName = String(deck?.leader || deck?.leaderName || deck?.leaderId || "").trim();
    if (!leaderName || cards.length === 0)
        return [];
    return [{
            id: String(deck?.deckId || deck?.id || "play_deck"),
            deckName: String(deck?.deckName || "Baralho de Teste"),
            leaderName,
            leaderKey: String(deck?.leaderKey || "").trim(),
            leaderImg: String(deck?.leaderImg || "").trim(),
            fragImg: String(deck?.fragImg || "").trim(),
            accessories: deck?.accessories && typeof deck.accessories === "object" ? {
                playmat: String(deck.accessories.playmat || "").trim() || undefined,
                sleeve: String(deck.accessories.sleeve || "").trim() || undefined
            } : undefined,
            cards
        }];
}
function deckFingerprint(deck) {
    return JSON.stringify([deck.deckName, deck.leaderName, deck.cards]);
}
function mergeDeckLists(primary, secondary) {
    const merged = [];
    const seen = new Set();
    for (const deck of [...primary, ...secondary]) {
        const fingerprint = deck.id || deckFingerprint(deck);
        if (seen.has(fingerprint))
            continue;
        seen.add(fingerprint);
        merged.push(deck);
    }
    return merged;
}
function cacheDecksForLobby(decks) {
    try {
        localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(decks.map((deck) => ({
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
            accessories: deck.accessories || undefined,
            cards: deck.cards
        }))));
    }
    catch {
        // ignore storage write failures
    }
    return decks;
}
async function readRemoteDecks() {
    const runtime = window;
    try {
        if (!runtime.firebase)
            return [];
        if (!runtime._mytragor_firebase_init_local && runtime.FIREBASE_CONFIG && runtime.firebase.initializeApp) {
            runtime.firebase.initializeApp(runtime.FIREBASE_CONFIG);
            runtime._mytragor_firebase_init_local = true;
        }
        if (!runtime.firebase.auth || !runtime.firebase.firestore)
            return [];
        const user = runtime.firebase.auth().currentUser;
        if (!user?.uid)
            return [];
        const snap = await runtime.firebase.firestore().collection("users").doc(user.uid).collection("decks").get();
        return normalizeDeckList(snap.docs.map((doc) => ({ _id: doc.id, ...(doc.data() || {}) })));
    }
    catch {
        return [];
    }
}
export function readSavedDecks() {
    try {
        const decks = readDecksFromLocalStorage();
        if (decks.length)
            return decks;
        return readPlayDeck();
    }
    catch {
        return [];
    }
    return [];
}
export async function hydrateSavedDecks() {
    const localDecks = readSavedDecks();
    const remoteDecks = await readRemoteDecks();
    if (!remoteDecks.length)
        return localDecks;
    return cacheDecksForLobby(mergeDeckLists(remoteDecks, localDecks));
}
