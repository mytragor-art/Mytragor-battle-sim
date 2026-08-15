import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const HTTP_BASE = process.env.HTTP_BASE ?? ENDPOINT.replace(/^ws/i, "http");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 20000);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
	if (!condition) throw new Error(`[ASSERT] ${message}`);
}

async function withTimeout(promise, ms, label) {
	let timer = null;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function waitFor(predicate, label, ms = TIMEOUT_MS) {
	return withTimeout(
		(async () => {
			while (true) {
				const value = await predicate();
				if (value) return value;
				await sleep(40);
			}
		})(),
		ms,
		label
	);
}

async function fetchJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.json();
}

async function main() {
	console.log(`[SOLO_SPECTATOR_SMOKE] endpoint=${ENDPOINT}`);
	const client = new Client(ENDPOINT);
	const room = await client.create("solo_lobby");
	const lobbyEvents = { assigned: null, state: null, start: null };
	room.onMessage("assign_slot", (msg) => {
		lobbyEvents.assigned = msg;
	});
	room.onMessage("lobby_state", (state) => {
		lobbyEvents.state = state;
	});
	room.onMessage("start_match", (msg) => {
		lobbyEvents.start = msg;
	});

	await waitFor(() => lobbyEvents.assigned && lobbyEvents.state, "solo lobby join and initial state");
	assert(lobbyEvents.assigned?.slot === "p1", `expected human slot p1, got ${lobbyEvents.assigned?.slot}`);

	room.send("set_name", { name: "Smoke Solo", avatarId: "chosen:valbrak" });
	room.send("choose_deck", { deckId: "solo-spectator-human", leaderId: "Valbrak, O Mago Popular", cards: [] });
	room.send("choose_leader", { leaderId: "Valbrak, O Mago Popular" });
	room.send("choose_bot_deck", { deckId: "solo-spectator-bot", leaderId: "Valbrak, O Mago Popular", cards: [] });
	room.send("ready", { ready: true });

	await waitFor(() => lobbyEvents.start, "solo start_match payload");
	assert(String(lobbyEvents.start?.matchRoomId || "").length > 0, "solo start_match should include matchRoomId");
	assert(String(lobbyEvents.start?.spectatorRoomId || "").length > 0, "solo start_match should include spectatorRoomId");

	const matchClient = new Client(ENDPOINT);
	const matchRoom = await matchClient.joinById(String(lobbyEvents.start?.matchRoomId || ""), { joinToken: String(lobbyEvents.start?.joinToken || "") });
	const matchEvents = { assigned: null, state: null };
	matchRoom.onMessage("assign_slot", (msg) => {
		matchEvents.assigned = msg;
	});
	matchRoom.onStateChange((state) => {
		matchEvents.state = state;
	});
	await waitFor(() => matchEvents.assigned && matchEvents.state, "solo match join after start_match");
	assert(matchEvents.assigned?.slot === "p1", "human should join the solo match as p1");

	const soloMatches = await fetchJson(`${HTTP_BASE.replace(/\/+$/, "")}/solo-matches`);
	const listed = Array.isArray(soloMatches?.rooms) ? soloMatches.rooms.find((entry) => entry?.roomId === lobbyEvents.start?.matchRoomId) : null;
	assert(listed, "solo match should be listed in /solo-matches");
	assert(String(listed?.spectatorRoomId || "") === String(lobbyEvents.start?.spectatorRoomId || ""), "listed spectatorRoomId should match start_match payload");

	const spectatorLookup = await fetchJson(`${HTTP_BASE.replace(/\/+$/, "")}/matches/${encodeURIComponent(String(lobbyEvents.start?.matchRoomId || ""))}/spectator`);
	assert(String(spectatorLookup?.spectatorRoomId || "") === String(lobbyEvents.start?.spectatorRoomId || ""), "spectator lookup should resolve the solo spectator room");

	const spectatorClient = new Client(ENDPOINT);
	const spectatorRoom = await spectatorClient.joinById(String(lobbyEvents.start?.spectatorRoomId || ""));
	const spectatorEvents = { assigned: null, state: null };
	spectatorRoom.onMessage("assign_slot", (msg) => {
		spectatorEvents.assigned = msg;
	});
	spectatorRoom.onStateChange((state) => {
		spectatorEvents.state = state;
	});

	await waitFor(() => spectatorEvents.assigned && spectatorEvents.state, "spectator join and initial state");
	assert(spectatorEvents.assigned?.spectator === true, "spectator room should mark the client as spectator");

	console.log("[SOLO_SPECTATOR_SMOKE] ✅ solo match is listed and watchable");

	try {
		await spectatorRoom.leave();
	} catch {
		// ignore cleanup failures
	}
	try {
		await matchRoom.leave();
	} catch {
		// ignore cleanup failures
	}
	try {
		await room.leave();
	} catch {
		// ignore cleanup failures
	}
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error("[SOLO_SPECTATOR_SMOKE] ❌ failed:", error?.stack ?? error);
		process.exit(1);
	}
);
