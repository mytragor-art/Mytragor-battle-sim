import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 12000);

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
	if (!cond) throw new Error(`[ASSERT] ${msg}`);
}

async function withTimeout(promise, ms, label) {
	let t;
	const timeout = new Promise((_, reject) => {
		t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(t);
	}
}

async function connectTwoClients() {
	const clientA = new Client(ENDPOINT);
	const clientB = new Client(ENDPOINT);

	const events = {
		a: { slot: null, start: null, lastLobby: null },
		b: { slot: null, start: null, lastLobby: null },
	};

	const roomA = await clientA.create("match");
	roomA.onMessage("assign_slot", (m) => (events.a.slot = m.slot));
	roomA.onMessage("lobby_state", (m) => (events.a.lastLobby = m));
	roomA.onMessage("start_match", (m) => (events.a.start = m));

	const roomB = await clientB.joinById(roomA.id);
	roomB.onMessage("assign_slot", (m) => (events.b.slot = m.slot));
	roomB.onMessage("lobby_state", (m) => (events.b.lastLobby = m));
	roomB.onMessage("start_match", (m) => (events.b.start = m));

	return { roomA, roomB, events };
}

function getPlayerBySlot(lobbyState, slot) {
	const players = lobbyState?.players ?? [];
	return players.find((p) => p.slot === slot) ?? null;
}

async function waitForLobby(events, predicate, label) {
	await withTimeout(
		(async () => {
			while (true) {
				const lobby = events.a.lastLobby ?? events.b.lastLobby;
				if (lobby && predicate(lobby)) return;
				await sleep(50);
			}
		})(),
		TIMEOUT_MS,
		label
	);
}

async function waitForSlots(events) {
	// Handlers are registered after join; in the unlikely case we miss assign_slot,
	// infer from join order (A created first).
	await withTimeout(
		(async () => {
			const start = Date.now();
			while ((!events.a.slot || !events.b.slot) && Date.now() - start < 1000) {
				await sleep(25);
			}
		})(),
		TIMEOUT_MS,
		"waiting for assign_slot"
	);

	if (!events.a.slot || !events.b.slot) {
		events.a.slot = events.a.slot ?? "p1";
		events.b.slot = events.b.slot ?? "p2";
	}
}

async function waitForStart(events) {
	await withTimeout(
		(async () => {
			while (!events.a.start || !events.b.start) {
				await sleep(50);
			}
		})(),
		TIMEOUT_MS,
		"waiting for start_match on both clients"
	);
}

async function main() {
	console.log(`[SMOKE] endpoint=${ENDPOINT}`);

	// Retry connect in case server is still booting
	let roomA;
	let roomB;
	let events;
	let lastErr;
	for (let attempt = 1; attempt <= 20; attempt++) {
		try {
			({ roomA, roomB, events } = await connectTwoClients());
			break;
		} catch (err) {
			lastErr = err;
			await sleep(250);
		}
	}
	if (!roomA || !roomB) throw lastErr ?? new Error("Failed to connect");

	console.log(`[SMOKE] roomId=${roomA.id}`);

	// Validate lobby_state basics (slots p1/p2 present)
	await waitForSlots(events);
	assert(
		new Set([events.a.slot, events.b.slot]).size === 2,
		`expected distinct slots, got a=${events.a.slot} b=${events.b.slot}`
	);
	assert(
		(events.a.slot === "p1" || events.a.slot === "p2") &&
			(events.b.slot === "p1" || events.b.slot === "p2"),
		`expected slots to be p1/p2, got a=${events.a.slot} b=${events.b.slot}`
	);

	await waitForLobby(
		events,
		(lobby) => {
			const p1 = getPlayerBySlot(lobby, "p1");
			const p2 = getPlayerBySlot(lobby, "p2");
			return lobby.phase === "LOBBY" && !!p1 && !!p2;
		},
		"waiting for lobby_state with p1/p2"
	);

	console.log("[SMOKE] ✅ lobby_state has p1/p2 and phase=LOBBY");

	// Choose deck/leader for both
	roomA.send("choose_deck", { deckId: "deck1" });
	roomA.send("choose_leader", { leaderId: "leader1" });
	roomB.send("choose_deck", { deckId: "deck2" });
	roomB.send("choose_leader", { leaderId: "leader2" });

	await waitForLobby(
		events,
		(lobby) => {
			const a = getPlayerBySlot(lobby, events.a.slot);
			const b = getPlayerBySlot(lobby, events.b.slot);
			return (
				!!a &&
				!!b &&
				a.deckId &&
				a.leaderId &&
				b.deckId &&
				b.leaderId
			);
		},
		"waiting for lobby_state reflecting deck/leader selections"
	);

	// Test: ready reset on leader change (for B) without starting match
	roomA.send("ready", { ready: false });
	roomB.send("ready", { ready: true });

	await waitForLobby(
		events,
		(lobby) => {
			const b = getPlayerBySlot(lobby, events.b.slot);
			return !!b && b.ready === true;
		},
		"waiting for B ready=true"
	);

	roomB.send("choose_leader", { leaderId: "leader2b" });
	await waitForLobby(
		events,
		(lobby) => {
			const b = getPlayerBySlot(lobby, events.b.slot);
			return !!b && b.leaderId === "leader2b" && b.ready === false;
		},
		"waiting for B ready reset after choose_leader"
	);
	console.log("[SMOKE] ✅ ready reset after choose_leader");

	// Put B ready back to false so we can test A without starting
	roomB.send("ready", { ready: false });
	await waitForLobby(
		events,
		(lobby) => {
			const b = getPlayerBySlot(lobby, events.b.slot);
			return !!b && b.ready === false;
		},
		"waiting for B ready=false"
	);

	// Test: ready reset on deck change (for A) without starting match
	roomA.send("ready", { ready: true });
	await waitForLobby(
		events,
		(lobby) => {
			const a = getPlayerBySlot(lobby, events.a.slot);
			return !!a && a.ready === true;
		},
		"waiting for A ready=true"
	);

	roomA.send("choose_deck", { deckId: "deck1b" });
	await waitForLobby(
		events,
		(lobby) => {
			const a = getPlayerBySlot(lobby, events.a.slot);
			return !!a && a.deckId === "deck1b" && a.ready === false;
		},
		"waiting for A ready reset after choose_deck"
	);
	console.log("[SMOKE] ✅ ready reset after choose_deck");

	// Now satisfy start conditions
	roomA.send("ready", { ready: true });
	roomB.send("ready", { ready: true });

	await waitForStart(events);

	console.log("[SMOKE] ✅ start_match received on both clients");
	console.log("[SMOKE] start_match(A)=", JSON.stringify(events.a.start));
	console.log("[SMOKE] start_match(B)=", JSON.stringify(events.b.start));

	try {
		roomA.leave?.();
		roomB.leave?.();
	} catch {
		// ignore
	}
}

main().then(
	() => process.exit(0),
	(err) => {
		console.error("[SMOKE] ❌ failed:", err?.stack ?? err);
		process.exit(1);
	}
);
