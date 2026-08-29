import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const LEADER = "Valbrak, O Mago Popular";
const TEMPESTADE = "Tempestade Arcana";
const FILLER = "Quebra-Aço";
const TIMEOUT_MS = 15000;

function assert(condition, message) {
	if (!condition) throw new Error(`[ASSERT] ${message}`);
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, label) {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		const value = predicate();
		if (value) return value;
		await sleep(40);
	}
	throw new Error(`Timeout: ${label}`);
}

function cards(cardId) {
	return Array.from({ length: 40 }, () => cardId);
}

async function main() {
	const client = new Client(ENDPOINT);
	const joinToken = `arcana-env-smoke-${Date.now()}`;
	const room = await client.create("solo_match", {
		joinToken,
		seatReservation: { joinToken, lobbySessionId: joinToken, slot: "p1", displayName: "Arcana Smoke" },
		starterSlot: "p1",
		p1: { deckId: "arcana-env-p1", leaderId: LEADER, cards: cards(TEMPESTADE) },
		p2: { deckId: "arcana-env-p2", leaderId: LEADER, cards: cards(FILLER) },
		bot: { displayName: "Arcana Bot", deckId: "arcana-env-p2", leaderId: LEADER, cards: cards(FILLER) }
	});

	let state = null;
	let phase = "";
	let turnSlot = "";
	let p2TurnStart = null;
	room.onStateChange((nextState) => {
		state = nextState;
		phase = String(nextState?.game?.phase || phase);
		turnSlot = String(nextState?.game?.turnSlot || turnSlot);
	});
	room.onMessage("turn_start", (message) => {
		phase = String(message?.phase || phase);
		turnSlot = String(message?.turnSlot || turnSlot);
		if (turnSlot === "p2") p2TurnStart = message;
	});
	room.onMessage("phase_changed", (message) => {
		phase = String(message?.phase || phase);
		turnSlot = String(message?.turnSlot || turnSlot);
	});
	room.onMessage("error", (message) => {
		throw new Error(`Game rejected an action: ${JSON.stringify(message)}`);
	});

	await waitFor(() => state && turnSlot === "p1" && phase === "MULLIGAN", "opening mulligan");
	room.send("submit_mulligan", { indices: [] });
	await waitFor(() => phase === "PREP", "preparation phase");
	room.send("next_phase");
	await waitFor(() => phase === "COMBAT", "opening combat phase");
	room.send("next_phase");
	await waitFor(() => phase === "END", "opening end phase");
	room.send("end_turn");
	await waitFor(() => turnSlot === "p1" && phase === "PREP" && Number(state?.game?.p1?.fragments || 0) >= 3, "return to human preparation with 3 fragments");
	room.send("play_card", { cardId: TEMPESTADE, cardKind: "env" });
	await waitFor(() => String(state?.game?.p1?.env || "") === TEMPESTADE, "Tempestade Arcana in play");
	const p2HandBeforeTurn = Number(state?.game?.p2?.hand?.length || 0);
	p2TurnStart = null;
	room.send("next_phase");
	await waitFor(() => phase === "COMBAT", "combat phase");
	room.send("next_phase");
	await waitFor(() => phase === "END", "end phase");
	room.send("end_turn");
	await waitFor(() => p2TurnStart, "opposing Arcana turn start");
	const p2HandAfterDraw = Number(p2TurnStart?.p2Hand || 0);
	assert(p2HandAfterDraw === p2HandBeforeTurn + 2, `expected p2 to draw 2 cards, had ${p2HandBeforeTurn} then ${p2HandAfterDraw}`);

	console.log(`[ARCANA_ENV_SMOKE] PASS: opposing Arcana leader drew ${p2HandAfterDraw - p2HandBeforeTurn} cards with Tempestade Arcana in play.`);
	await room.leave();
}

main().then(() => process.exit(0)).catch((error) => {
	console.error("[ARCANA_ENV_SMOKE] FAIL:", error?.stack ?? error);
	process.exit(1);
});