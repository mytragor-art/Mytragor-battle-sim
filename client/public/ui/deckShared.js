(function (global) {
	"use strict";

	const CHOSEN_IMAGES = {
		katsu: "../chosens/layout-katsuvingador.ai.png",
		valbrak: "../chosens/layout-valbrak.ai.png",
		leafae: "../chosens/layout-leafaefloresta.ai.png",
		ademais: "../chosens/layout-ademais.ai.png"
	};

	const CARD_BACK_IMAGE = "layout-background.ai.png";
	const DECK_EDIT_DRAFT_KEY = "mytragor_deck_edit_draft";
	const ASSET_CACHE_VERSION = "2026-05-17-2";

	function initFirebaseCompatLocal() {
		try {
			if (global._mytragor_firebase_init_local) return;
			if (typeof global.FIREBASE_CONFIG === "undefined") return;
			if (global.firebase && global.firebase.initializeApp) {
				global.firebase.initializeApp(global.FIREBASE_CONFIG);
				global._mytragor_firebase_init_local = true;
			}
		} catch (error) {
			console.warn("initFirebaseCompatLocal failed", error);
		}
	}

	async function loadUserDecksFromFirestoreLocal() {
		try {
			initFirebaseCompatLocal();
			if (!global.firebase || !global.firebase.auth) return [];
			const user = global.firebase.auth().currentUser;
			if (!user) return [];
			const db = global.firebase.firestore();
			const snap = await db.collection("users").doc(user.uid).collection("decks").get();
			return snap.docs.map((doc) => ({ _id: doc.id, ...(doc.data() || {}) }));
		} catch (error) {
			console.warn("loadUserDecksFromFirestoreLocal failed", error);
			return [];
		}
	}

	async function deleteDeckFromFirestoreLocal(id) {
		try {
			initFirebaseCompatLocal();
			if (!global.firebase || !global.firebase.auth) return false;
			const user = global.firebase.auth().currentUser;
			if (!user) return false;
			const db = global.firebase.firestore();
			await db.collection("users").doc(user.uid).collection("decks").doc(id).delete();
			return true;
		} catch (error) {
			console.warn("deleteDeckFromFirestoreLocal failed", error);
			return false;
		}
	}

	function normalizeCardName(value) {
		return String(value || "")
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.trim();
	}

	function matchesCardName(card, value) {
		const expected = normalizeCardName(value);
		if (!expected || !card) return false;
		if (normalizeCardName(card.name) === expected) return true;
		return Array.isArray(card.aliases) && card.aliases.some((alias) => normalizeCardName(alias) === expected);
	}

	function normalizeDeck(raw, index) {
		const source = raw && typeof raw === "object" ? raw : {};
		const cards = Array.isArray(source.cards)
			? source.cards
				.map((card) => {
					if (typeof card === "string") return card;
					if (card && typeof card === "object" && typeof card.name === "string") return card.name;
					return String(card || "").trim();
				})
				.filter(Boolean)
			: [];
		const leaderDef = global.CARD_DEFS.find((card) => {
			if (!card || card.kind !== "leader") return false;
			if (source.leaderKey && String(card.key || "").toLowerCase() === String(source.leaderKey || "").toLowerCase()) return true;
			return matchesCardName(card, source.leader || source.leaderName || "");
		}) || null;
		const deckName = String(source.deckName || source.leader || source.leaderName || `Deck ${index + 1}`);
		const leaderName = String((leaderDef && leaderDef.name) || source.leader || source.leaderName || "Desconhecido");
		return {
			...source,
			deckName,
			leader: leaderName,
			leaderName,
			leaderKey: source.leaderKey ? String(source.leaderKey) : (leaderDef && leaderDef.key ? String(leaderDef.key) : ""),
			leaderImg: source.leaderImg ? String(source.leaderImg) : "",
			fragImg: source.fragImg ? String(source.fragImg) : "",
			tags: Array.isArray(source.tags) ? source.tags.map((tag) => String(tag)) : [],
			cards
		};
	}

	function getDeckName(deck) {
		return deck.deckName || deck.leader || deck.leaderName || "Deck";
	}

	function getLeaderName(deck) {
		return deck.leader || deck.leaderName || "Desconhecido";
	}

	function getDeckKey(deck) {
		if (deck._id) return `remote:${deck._id}`;
		return [getDeckName(deck), getLeaderName(deck), deck.fragImg || "", (deck.cards || []).join("|")].join("::");
	}

	function openDeckInEditor(deck) {
		try {
			global.localStorage.setItem(DECK_EDIT_DRAFT_KEY, JSON.stringify({
				mode: deck && deck._id ? "copy" : "edit",
				deck: normalizeDeck(deck, 0)
			}));
		} catch (error) {
			console.warn("openDeckInEditor failed", error);
		}
		global.location.href = "deckbuilder.html?edit=1";
	}

	function normalizeLeaderKey(value) {
		return String(value || "")
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-z0-9]+/g, "");
	}

	function resolveLeaderImage(deck) {
		if (deck.leaderImg) return deck.leaderImg;
		const leaderKey = normalizeLeaderKey(deck.leaderKey || deck.leader || deck.leaderName || "");
		if (leaderKey.includes("ademais")) return CHOSEN_IMAGES.ademais;
		if (leaderKey.includes("katsu")) return CHOSEN_IMAGES.katsu;
		if (leaderKey.includes("valbrak")) return CHOSEN_IMAGES.valbrak;
		if (leaderKey.includes("leafae")) return CHOSEN_IMAGES.leafae;
		return CARD_BACK_IMAGE;
	}

	function updateDeckCount(count) {
		const element = global.document.getElementById("deckCount");
		if (element) element.textContent = `${count} deck${count === 1 ? "" : "s"} salvo${count === 1 ? "" : "s"}`;
	}

	function withAssetVersion(url) {
		try {
			const resolved = new URL(url, global.location.href);
			if (!/^https?:$/i.test(resolved.protocol)) return resolved.href;
			if (resolved.origin !== global.location.origin) return resolved.href;
			resolved.searchParams.set("v", ASSET_CACHE_VERSION);
			return resolved.href;
		} catch {
			return url;
		}
	}

	function resolveImg(path) {
		if (!path) return CARD_BACK_IMAGE;
		try {
			if (/^(data:|file:|\/\/)/i.test(path)) return path;
			let normalized = String(path).replace(/\\/g, "/").replace(/[?#].*$/, "").replace(/^\.\//, "").replace(/^\.\.\//, "");
			const href = (global.location && global.location.href) || "";
			const pathname = (global.location && global.location.pathname) || "";
			const inLegacyAssetsUi = pathname.includes("/assets/ui/");
			const inUi = pathname.includes("/ui/");

			if (normalized.startsWith("assets/")) {
				if (inLegacyAssetsUi) {
					const marker = "/assets/ui/";
					const idx = href.indexOf(marker);
					if (idx >= 0) {
						const root = href.slice(0, idx + 1);
						return new URL(normalized, root).href;
					}
				}
				normalized = normalized.slice("assets/".length);
			}

			const candidate = inLegacyAssetsUi || inUi ? `../${normalized}` : normalized;
			return withAssetVersion(new URL(candidate, href).href);
		} catch {
			return path;
		}
	}

	function resolveThumbImg(path) {
		if (!path) return resolveImg(CARD_BACK_IMAGE);
		try {
			let normalized = String(path).replace(/\\/g, "/").replace(/[?#].*$/, "").replace(/^\.\//, "").replace(/^\.\.\//, "");
			if (normalized.startsWith("assets/")) {
				normalized = normalized.slice("assets/".length);
			}
			const thumbPath = `publicadas/${normalized.replace(/\.(png|jpe?g|webp|avif)$/i, ".thumb.webp")}`;
			return resolveImg(thumbPath);
		} catch {
			return resolveImg(path);
		}
	}

	function attachGridThumb(imgEl, assetPath) {
		if (!imgEl) return;
		const fallbackSrc = resolveImg(assetPath || CARD_BACK_IMAGE);
		imgEl.loading = "lazy";
		imgEl.decoding = "async";
		imgEl.dataset.fallbackSrc = fallbackSrc;
		imgEl.src = resolveThumbImg(assetPath || CARD_BACK_IMAGE);
		imgEl.onerror = function () {
			if (this.dataset.fallbackSrc && this.src !== this.dataset.fallbackSrc) {
				this.src = this.dataset.fallbackSrc;
				return;
			}
			this.src = CARD_BACK_IMAGE;
		};
	}

	function getCardDef(cardName) {
		if (!global.CARD_DEFS) return null;
		return global.CARD_DEFS.find((card) => matchesCardName(card, cardName)) || null;
	}

	function getCardImg(cardName) {
		const def = getCardDef(cardName);
		return resolveImg(def && def.img ? def.img : CARD_BACK_IMAGE);
	}

	function getGridCardImg(cardName) {
		const def = getCardDef(cardName);
		return resolveThumbImg(def && def.img ? def.img : CARD_BACK_IMAGE);
	}

	function encodeDeck(deck) {
		try {
			const deckData = {
				leader: deck.leaderName || deck.leader || "",
				leaderKey: deck.leaderKey || "",
				cards: deck.cards || [],
				fragImg: deck.fragImg || null,
				deckName: deck.deckName || ""
			};
			return `MTG:${btoa(JSON.stringify(deckData))}`;
		} catch (error) {
			console.warn("encodeDeck failed", error);
			return "";
		}
	}

	async function getSavedDecks() {
		let remote = [];
		try {
			remote = await loadUserDecksFromFirestoreLocal();
		} catch {}
		if (Array.isArray(remote) && remote.length) {
			const normalizedRemote = remote.map((deck, index) => normalizeDeck(deck, index));
			try {
				global.localStorage.setItem("mytragor_decks", JSON.stringify(normalizedRemote));
			} catch (error) {
				console.warn("sync remote decks to localStorage failed", error);
			}
			return normalizedRemote;
		}
		const raw = global.localStorage.getItem("mytragor_decks");
		if (!raw) return [];
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.map((deck, index) => normalizeDeck(deck, index)) : [];
		} catch {
			return [];
		}
	}

	global.MytragorDeckShared = {
		ASSET_CACHE_VERSION,
		CARD_BACK_IMAGE,
		CHOSEN_IMAGES,
		DECK_EDIT_DRAFT_KEY,
		attachGridThumb,
		deleteDeckFromFirestoreLocal,
		encodeDeck,
		getCardDef,
		getCardImg,
		getDeckKey,
		getDeckName,
		getGridCardImg,
		getLeaderName,
		getSavedDecks,
		initFirebaseCompatLocal,
		loadUserDecksFromFirestoreLocal,
		matchesCardName,
		normalizeCardName,
		normalizeDeck,
		normalizeLeaderKey,
		openDeckInEditor,
		resolveImg,
		resolveLeaderImage,
		resolveThumbImg,
		updateDeckCount,
		withAssetVersion
	};
})(window);