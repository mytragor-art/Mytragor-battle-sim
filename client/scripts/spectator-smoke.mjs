import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const HTTP_BASE = process.env.HTTP_BASE ?? ENDPOINT.replace(/^ws/i, "http");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 20000);
const EXTRA_SPECTATORS = Number(process.env.EXTRA_SPECTATORS ?? 4);

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

function lobbyEvents() {
	return { slot: null, start: null, lastLobby: null };
}

function matchEvents() {
	return {
		assign: null,
		state: null,
		phaseChanged: [],
		effectChoices: [],
		reveals: [],
		logs: []
	};
}

function bindLobby(room, events) {
	room.onMessage("assign_slot", (msg) => {
		events.slot = msg?.slot || null;
	});
	room.onMessage("lobby_state", (msg) => {
		events.lastLobby = msg;
	});
	room.onMessage("start_match", (msg) => {
		events.start = msg;
	});
}

function bindMatch(room, events) {
	room.onMessage("assign_slot", (msg) => {
		events.assign = msg;
	});
	room.onMessage("phase_changed", (msg) => {
		events.phaseChanged.push(msg);
	});
	room.onMessage("effect_choice_required", (msg) => {
		events.effectChoices.push(msg);
	});
	room.onMessage("revealed_top_card", (msg) => {
		events.reveals.push(msg);
	});
	room.onMessage("effect_log", (msg) => {
		events.logs.push(msg);
	});
	room.onStateChange((state) => {
		events.state = state;
	});
}

function getPlayerBySlot(lobbyState, slot) {
	const players = Array.isArray(lobbyState?.players) ? lobbyState.players : [];
	return players.find((player) => player?.slot === slot) ?? null;
}

async function createReadyLobbyPair() {
	const clientA = new Client(ENDPOINT);
	const clientB = new Client(ENDPOINT);
	const eventsA = lobbyEvents();
	const eventsB = lobbyEvents();
	const roomA = await clientA.create("lobby");
	bindLobby(roomA, eventsA);
	const roomB = await clientB.joinById(roomA.id);
	bindLobby(roomB, eventsB);

	await waitFor(() => eventsA.lastLobby && eventsB.lastLobby, "lobby state on both clients");

	roomA.send("set_name", { name: "Tester A" });
	roomB.send("set_name", { name: "Tester B" });
	roomA.send("choose_deck", { deckId: "deck-a", leaderId: "leader-a", cards: [] });
	roomA.send("choose_leader", { leaderId: "leader-a" });
	roomB.send("choose_deck", { deckId: "deck-b", leaderId: "leader-b", cards: [] });
	roomB.send("choose_leader", { leaderId: "leader-b" });

	await waitFor(() => {
		const lobby = eventsA.lastLobby ?? eventsB.lastLobby;
		const p1 = getPlayerBySlot(lobby, "p1");
		const p2 = getPlayerBySlot(lobby, "p2");
		return p1?.deckId && p2?.deckId && p1?.leaderId && p2?.leaderId;
	}, "decks/leaders reflected in lobby");

	roomA.send("ready", { ready: true });
	roomB.send("ready", { ready: true });

	await waitFor(() => eventsA.start && eventsB.start, "start_match for both players");

	return {
		clientA,
		clientB,
		lobbyA: roomA,
		lobbyB: roomB,
		startA: eventsA.start,
		startB: eventsB.start
	};
}

async function fetchJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.json();
}

async function main() {
	console.log(`[SPECTATOR_SMOKE] endpoint=${ENDPOINT}`);
	const created = await createReadyLobbyPair();
	const matchRoomId = String(created.startA?.matchRoomId || "").trim();
	const spectatorRoomIdFromStart = String(created.startA?.spectatorRoomId || "").trim();
	const joinTokenA = String(created.startA?.joinToken || "").trim();
	const joinTokenB = String(created.startB?.joinToken || "").trim();
	assert(matchRoomId, "matchRoomId should exist in start_match payload");
	assert(spectatorRoomIdFromStart, "spectatorRoomId should exist in start_match payload");

	const matchList = await fetchJson(`${HTTP_BASE.replace(/\/+$/, "")}/matches`);
	const listedMatch = Array.isArray(matchList?.rooms) ? matchList.rooms.find((room) => room?.roomId === matchRoomId) : null;
	assert(listedMatch, "match should be listed in /matches");
	assert(String(listedMatch?.spectatorRoomId || "") === spectatorRoomIdFromStart, "listed spectatorRoomId should match start_match payload");
	console.log("[SPECTATOR_SMOKE] ✅ /matches lists the live match");

	const spectatorLookup = await fetchJson(`${HTTP_BASE.replace(/\/+$/, "")}/matches/${encodeURIComponent(matchRoomId)}/spectator`);
	assert(String(spectatorLookup?.spectatorRoomId || "") === spectatorRoomIdFromStart, "spectator lookup endpoint should resolve the spectator room");
	console.log("[SPECTATOR_SMOKE] ✅ spectator lookup endpoint resolves the room");

	const matchClientA = new Client(ENDPOINT);
	const matchClientB = new Client(ENDPOINT);
	const playerAEvents = matchEvents();
	const playerBEvents = matchEvents();
	const playerARoom = await matchClientA.joinById(matchRoomId, { joinToken: joinTokenA });
	const playerBRoom = await matchClientB.joinById(matchRoomId, { joinToken: joinTokenB });
	bindMatch(playerARoom, playerAEvents);
	bindMatch(playerBRoom, playerBEvents);

	const spectatorClients = [];
	const spectatorRooms = [];
	const spectatorEvents = [];
	for (let index = 0; index < EXTRA_SPECTATORS; index += 1) {
		const client = new Client(ENDPOINT);
		const room = await client.joinById(spectatorRoomIdFromStart);
		const events = matchEvents();
		bindMatch(room, events);
		spectatorClients.push(client);
		spectatorRooms.push(room);
		spectatorEvents.push(events);
	}

	await waitFor(() => playerAEvents.state && playerBEvents.state && spectatorEvents.every((events) => !!events.state), "initial match and spectator state");

	for (const [index, events] of spectatorEvents.entries()) {
		assert(events.assign?.spectator === true, `spectator ${index} should receive spectator assign message`);
		const p1Hand = Array.from(events.state?.game?.p1?.hand ?? []);
		const p2Hand = Array.from(events.state?.game?.p2?.hand ?? []);
		const p1Deck = Array.from(events.state?.game?.p1?.deck ?? []);
		const p2Deck = Array.from(events.state?.game?.p2?.deck ?? []);
		assert(p1Hand.length > 0 && p2Hand.length > 0, `spectator ${index} should see hidden hand counts`);
		assert(p1Hand.every((value) => value === "__spectator_hand_hidden__"), `spectator ${index} p1 hand should be masked`);
		assert(p2Hand.every((value) => value === "__spectator_hand_hidden__"), `spectator ${index} p2 hand should be masked`);
		assert(p1Deck.every((value) => value === "__spectator_deck_hidden__"), `spectator ${index} p1 deck should be masked`);
		assert(p2Deck.every((value) => value === "__spectator_deck_hidden__"), `spectator ${index} p2 deck should be masked`);
		assert(events.effectChoices.length === 0, `spectator ${index} should not receive effect choices on join`);
		assert(events.reveals.length === 0, `spectator ${index} should not receive reveal events on join`);
	}
	console.log(`[SPECTATOR_SMOKE] ✅ ${EXTRA_SPECTATORS} spectator(s) received masked state`);

	const phaseBefore = String(playerAEvents.state?.game?.phase || "");
	const phaseEventCountBefore = spectatorEvents[0]?.phaseChanged.length ?? 0;
	await spectatorRooms[0].send("next_phase");
	await sleep(250);
	const phaseAfterSpectatorSend = String(playerAEvents.state?.game?.phase || "");
	assert(phaseAfterSpectatorSend === phaseBefore, "spectator action should not change the phase");
	assert((spectatorEvents[0]?.phaseChanged.length ?? 0) === phaseEventCountBefore, "spectator action should not emit phase changes");
	console.log("[SPECTATOR_SMOKE] ✅ spectator actions do not mutate the match");

	const activePlayerRoom = String(playerAEvents.state?.game?.turnSlot || "") === String(playerAEvents.assign?.slot || "") ? playerARoom : playerBRoom;
	const activePlayerEvents = activePlayerRoom === playerARoom ? playerAEvents : playerBEvents;
	const phaseBeforePlayerAction = String(activePlayerEvents.state?.game?.phase || "");
	activePlayerRoom.send("next_phase");
	const phasePayload = await waitFor(() => spectatorEvents.every((events) => events.phaseChanged.length >= phaseEventCountBefore + 1), "phase_changed delivered to all spectators");
	void phasePayload;
	await waitFor(() => spectatorEvents.every((events) => String(events.state?.game?.phase || "") !== phaseBeforePlayerAction), "spectator snapshots updated after phase change");
	console.log("[SPECTATOR_SMOKE] ✅ public phase updates propagate to every spectator");

	for (const [index, events] of spectatorEvents.entries()) {
		assert(events.effectChoices.length === 0, `spectator ${index} should still have no private choice prompts`);
		assert(events.reveals.length === 0, `spectator ${index} should still have no private reveal prompts`);
	}

	const cleanup = [created.lobbyA, created.lobbyB, playerARoom, playerBRoom, ...spectatorRooms];
	for (const room of cleanup) {
		try {
			await room.leave();
		} catch {
			// ignore cleanup failures
		}
	}

	console.log("[SPECTATOR_SMOKE] ✅ all spectator smoke checks passed");
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error("[SPECTATOR_SMOKE] ❌ failed:", error?.stack ?? error);
		process.exit(1);
	}
);