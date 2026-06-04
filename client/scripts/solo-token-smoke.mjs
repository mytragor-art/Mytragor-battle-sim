import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 20000);
const TOKEN_CARD_IDS = new Set(["Cidadãos Unidos", "token_aranhas", "Aranhas Negras, Novato"]);
const FILLER_CARD = "Quebra-Aço";
const TOKEN_GENERATOR = "Ajuda do Povo";
const LEADER = "Valbrak, O Mago Popular";

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

function repeated(cardId, total = 40) {
	return Array.from({ length: total }, () => cardId);
}

async function main() {
	console.log(`[SOLO_TOKEN_SMOKE] endpoint=${ENDPOINT}`);

	const client = new Client(ENDPOINT);
	const joinToken = `solo-token-smoke-${Date.now()}`;
	const room = await client.create("solo_match", {
		joinToken,
		seatReservation: {
			joinToken,
			lobbySessionId: `solo-token-smoke-${Date.now()}`,
			slot: "p1",
			displayName: "Smoke Solo"
		},
		starterSlot: "p2",
		p1: {
			deckId: "solo-token-human",
			leaderId: LEADER,
			cards: repeated(FILLER_CARD)
		},
		p2: {
			deckId: "solo-token-bot",
			leaderId: LEADER,
			cards: repeated(TOKEN_GENERATOR)
		},
		bot: {
			displayName: "Bot Smoke",
			deckId: "solo-token-bot",
			leaderId: LEADER,
			cards: repeated(TOKEN_GENERATOR)
		}
	});

	const events = {
		assigned: null,
		state: null,
		turns: [],
		phases: [],
		plays: [],
		attacks: [],
		ended: null
	};

	let currentTurn = 0;
	let currentTurnSlot = "";
	let currentPhase = "";
	let observedTokenTurn = null;
	const observedTokenPositions = new Set();
	let sameTurnTokenAttack = null;

	room.onMessage("assign_slot", (msg) => {
		events.assigned = msg;
	});
	room.onMessage("turn_start", (msg) => {
		events.turns.push(msg);
		currentTurn = Number(msg?.turn || 0);
		currentTurnSlot = String(msg?.turnSlot || "");
		currentPhase = String(msg?.phase || currentPhase || "");
	});
	room.onMessage("phase_changed", (msg) => {
		events.phases.push(msg);
		currentPhase = String(msg?.phase || currentPhase || "");
	});
	room.onMessage("card_played", (msg) => {
		events.plays.push({ ...msg, observedTurn: currentTurn, observedTurnSlot: currentTurnSlot });
		if (String(msg?.slot || "") !== "p2") return;
		if (String(msg?.lane || "") !== "field") return;
		if (!TOKEN_CARD_IDS.has(String(msg?.cardId || ""))) return;
		if (!Number.isInteger(msg?.targetPos)) return;
		observedTokenTurn = currentTurn;
		observedTokenPositions.add(Number(msg.targetPos));
	});
	room.onMessage("attack_resolved", (msg) => {
		events.attacks.push({ ...msg, observedTurn: currentTurn, observedTurnSlot: currentTurnSlot, observedPhase: currentPhase });
		if (sameTurnTokenAttack) return;
		if (String(msg?.attackerSlot || "") !== "p2") return;
		if (!Number.isInteger(msg?.attackerPos)) return;
		if (observedTokenTurn == null) return;
		if (currentTurn !== observedTokenTurn) return;
		if (!observedTokenPositions.has(Number(msg.attackerPos))) return;
		sameTurnTokenAttack = {
			attackerPos: Number(msg.attackerPos),
			turn: currentTurn,
			phase: currentPhase,
			target: msg?.target,
			payload: msg
		};
	});
	room.onMessage("match_ended", (msg) => {
		events.ended = msg;
	});
	room.onStateChange((state) => {
		events.state = state;
		currentTurn = Number(state?.game?.turn || currentTurn || 0);
		currentTurnSlot = String(state?.game?.turnSlot || currentTurnSlot || "");
		currentPhase = String(state?.game?.phase || currentPhase || "");
	});

	await waitFor(() => events.assigned && events.state, "solo match join and initial state");
	assert(events.assigned?.slot === "p1", `expected human slot p1, got ${events.assigned?.slot}`);

	const advanceHumanTurn = async () => {
		await waitFor(() => currentTurnSlot === "p1", "wait for human turn");
		if (currentPhase === "INITIAL") {
			room.send("next_phase");
			await waitFor(() => currentPhase === "PREP", "advance human turn to PREP");
		}
		if (currentPhase === "PREP") {
			room.send("next_phase");
			await waitFor(() => currentPhase === "COMBAT", "advance human turn to COMBAT");
		}
		if (currentPhase === "COMBAT") {
			room.send("next_phase");
			await waitFor(() => currentPhase === "END", "advance human turn to END");
		}
		room.send("end_turn");
	};

	await waitFor(() => currentTurnSlot === "p2" && currentTurn >= 1, "wait for bot opening turn");
	await waitFor(() => currentTurnSlot === "p1" && currentTurn >= 2, "wait for first human turn after bot opening");
	await advanceHumanTurn();

	await waitFor(() => observedTokenTurn != null || sameTurnTokenAttack != null, "wait for bot to generate tokens", 30000);
	assert(observedTokenTurn != null, "bot should generate tokens during the test");
	assert(observedTokenPositions.size > 0, "bot should place at least one token on the field");

	await waitFor(() => currentTurn > observedTokenTurn || events.ended, "wait for token turn to finish", 30000);
	assert(!sameTurnTokenAttack, `token attacked on the same turn it was summoned: ${JSON.stringify(sameTurnTokenAttack)}`);

	console.log(`[SOLO_TOKEN_SMOKE] ✅ bot generated token(s) on turn ${observedTokenTurn}`);
	console.log(`[SOLO_TOKEN_SMOKE] ✅ token positions ${JSON.stringify([...observedTokenPositions])} did not attack on the same turn`);

	try {
		await room.leave();
	} catch {
		// ignore cleanup errors
	}
	process.exit(0);
}

main().catch((error) => {
	console.error("[SOLO_TOKEN_SMOKE] ❌ failed:", error?.stack ?? error);
	process.exit(1);
});