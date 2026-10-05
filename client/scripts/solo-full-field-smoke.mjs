import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 90000);
const LEADER = "Valbrak, O Mago Popular";
const BOT_ALLY = "Aranhas Negras, Novato";
const HUMAN_CARD = "Quebra-Aço";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
	if (!condition) throw new Error(`[ASSERT] ${message}`);
}

function repeated(cardId, total = 40) {
	return Array.from({ length: total }, () => cardId);
}

async function waitFor(predicate, label, timeoutMs = TIMEOUT_MS) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await predicate()) return;
		await sleep(40);
	}
	throw new Error(`Timeout after ${timeoutMs}ms: ${label}`);
}

async function main() {
	console.log(`[SOLO_FULL_FIELD_SMOKE] endpoint=${ENDPOINT}`);
	const client = new Client(ENDPOINT);
	const joinToken = `solo-full-field-smoke-${Date.now()}`;
	const room = await client.create("solo_match", {
		joinToken,
		seatReservation: {
			joinToken,
			lobbySessionId: joinToken,
			slot: "p1",
			displayName: "Smoke Full Field"
		},
		p1: { deckId: "full-field-human", leaderId: LEADER, cards: repeated(HUMAN_CARD) },
		p2: { deckId: "full-field-bot", leaderId: LEADER, cards: repeated(BOT_ALLY) },
		bot: { displayName: "Bot Smoke", deckId: "full-field-bot", leaderId: LEADER, cards: repeated(BOT_ALLY) }
	});

	let state = null;
	let slot = "";
	room.onMessage("assign_slot", (message) => {
		slot = String(message?.slot || "");
	});
	room.onStateChange((nextState) => {
		state = nextState;
	});

	const phase = () => String(state?.game?.phase || "");
	const turnSlot = () => String(state?.game?.turnSlot || "");
	const fieldSize = () => [...(state?.game?.p2?.field || [])].filter(Boolean).length;

	await waitFor(() => state && slot === "p1", "room join");
	room.send("roll_initiative");
	await waitFor(
		() => phase() === "MULLIGAN" || String(state?.initiativeStatus || "") === "CHOOSING",
		"initiative result"
	);
	if (String(state?.initiativeStatus || "") === "CHOOSING") room.send("choose_starter", { starterSlot: "p2" });
	await waitFor(() => phase() === "MULLIGAN", "opening mulligan");
	room.send("submit_mulligan", { indices: [] });

	async function completeHumanTurn() {
		await waitFor(() => turnSlot() === "p1" && phase() === "INITIAL", "human initial phase");
		room.send("next_phase");
		await waitFor(() => phase() === "PREP", "human prep phase");
		room.send("next_phase");
		await waitFor(() => phase() === "COMBAT", "human combat phase");
		room.send("next_phase");
		await waitFor(() => phase() === "END", "human end phase");
		room.send("end_turn");
	}

	for (let round = 0; round < 8 && fieldSize() < 5; round += 1) {
		await completeHumanTurn();
		await waitFor(() => turnSlot() === "p1" || fieldSize() === 5, "bot turn completion");
	}

	assert(fieldSize() === 5, `expected a full bot field, got ${fieldSize()} allies`);
	await waitFor(() => turnSlot() === "p1" && phase() === "INITIAL", "bot completes its full-field turn");
	await completeHumanTurn();
	await waitFor(() => turnSlot() === "p2" && phase() === "COMBAT", "bot advances from a full field to combat", 20000);

	console.log("[SOLO_FULL_FIELD_SMOKE] PASS bot filled the field and advanced to combat without looping");
	await room.leave();
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error("[SOLO_FULL_FIELD_SMOKE] FAIL", error?.stack ?? error);
		process.exit(1);
	}
);