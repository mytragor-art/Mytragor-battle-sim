import { Client } from "colyseus.js";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 45_000);
const LEADER = "Valbrak, O Mago Popular";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
	if (!condition) throw new Error(`[ASSERT] ${message}`);
}

async function waitFor(predicate, label, timeout = TIMEOUT_MS) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeout) {
		const value = predicate();
		if (value) return value;
		await sleep(50);
	}
	throw new Error(`Timeout waiting for ${label}`);
}

function repeated(cardId, count = 40) {
	return Array.from({ length: count }, () => cardId);
}

async function openSoloMatch(label, p1Cards, p2Cards) {
	const client = new Client(ENDPOINT);
	const joinToken = `card-revision-${label}-${Date.now()}`;
	const room = await client.create("solo_match", {
		joinToken,
		seatReservation: {
			joinToken,
			lobbySessionId: joinToken,
			slot: "p1",
			displayName: `Smoke ${label}`
		},
		starterSlot: "p2",
		p1: { deckId: `${label}-p1`, leaderId: LEADER, cards: p1Cards },
		p2: { deckId: `${label}-p2`, leaderId: LEADER, cards: p2Cards },
		bot: { displayName: "Bot Smoke", deckId: `${label}-p2`, leaderId: LEADER, cards: p2Cards }
	});

	const events = { assigned: null, state: null, choices: [], logs: [], plays: [] };
	room.onMessage("assign_slot", (message) => { events.assigned = message; });
	room.onMessage("effect_choice_required", (message) => { events.choices.push(message); });
	room.onMessage("effect_log", (message) => { events.logs.push(message); });
	room.onMessage("card_played", (message) => { events.plays.push(message); });
	room.onStateChange((state) => { events.state = state; });

	await waitFor(() => events.assigned && events.state, `${label} room join`);
	assert(events.assigned?.slot === "p1", `${label} should assign the human player to p1`);
	await waitFor(() => String(events.state?.phase || "") === "INITIATIVE", `${label} initiative`);
	room.send("roll_initiative");
	await waitFor(() => String(events.state?.initiativeStatus || "") !== "ROLLING", `${label} initiative roll`);
	if (String(events.state?.initiativeStatus || "") === "CHOOSING") {
		room.send("choose_starter", { starterSlot: "p2" });
	}
	await waitFor(() => String(events.state?.game?.phase || "") === "MULLIGAN", `${label} mulligan`);
	room.send("submit_mulligan", { indices: [] });
	await waitFor(() => String(events.state?.game?.phase || "") !== "MULLIGAN", `${label} mulligan resolution`);

	return { room, events };
}

async function ensureP1Prep(context) {
	await waitFor(
		() => String(context.events.state?.game?.turnSlot || "") === "p1" && String(context.events.state?.game?.phase || "") === "PREP",
		"p1 prep phase"
	);
}

async function finishP1Turn(context) {
	await ensureP1Prep(context);
	context.room.send("next_phase");
	await waitFor(() => String(context.events.state?.game?.phase || "") === "COMBAT", "combat phase");
	context.room.send("next_phase");
	await waitFor(() => String(context.events.state?.game?.phase || "") === "END", "end phase");
	context.room.send("end_turn");
}

async function passP1Turn(context) {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		await waitFor(() => String(context.events.state?.game?.turnSlot || "") === "p1", "p1 turn");
		const phase = String(context.events.state?.game?.phase || "");
		if (phase === "INITIAL") {
			await waitFor(() => String(context.events.state?.game?.phase || "") !== "INITIAL", "automatic p1 initial phase");
			continue;
		}
		if (phase === "PREP" || phase === "COMBAT") {
			context.room.send("next_phase");
			await waitFor(() => String(context.events.state?.game?.phase || "") !== phase, `p1 leave ${phase}`);
			continue;
		}
		if (phase === "END") {
			context.room.send("end_turn");
			await waitFor(() => String(context.events.state?.game?.turnSlot || "") !== "p1", "p1 end turn");
			return;
		}
	}
	throw new Error("Could not finish the p1 turn");
}

async function prepareFragments(context, required) {
	for (let turn = 0; turn < 8; turn += 1) {
		await ensureP1Prep(context);
		if (Number(context.events.state?.game?.p1?.fragments || 0) >= required) return;
		await finishP1Turn(context);
	}
	throw new Error(`Could not reach ${required} fragments`);
}

function latestChoice(context, predicate) {
	return [...context.events.choices].reverse().find(predicate) ?? null;
}

async function waitForChoice(context, predicate, label) {
	return waitFor(() => latestChoice(context, predicate), label);
}

async function close(context) {
	try {
		await context.room.leave();
	} catch {
		// Test cleanup should not hide an assertion result.
	}
}

async function testSacrificeDamage() {
	const context = await openSoloMatch("milicia", repeated("Aranhas Negras, Milícia"), repeated("Thorn, o Martelo da Montanha"));
	try {
		await prepareFragments(context, 3);
		context.room.send("play_card", { cardId: "Aranhas Negras, Milícia", cardKind: "spell" });
		const ownChoice = await waitForChoice(context, (choice) => String(choice?.title || "").includes("receber 3 de dano"), "Milícia own-damage choice");
		context.room.send("effect_choice_submit", { choiceId: ownChoice.choiceId, optionId: "blood-own-leader" });
		const enemyChoice = await waitForChoice(context, (choice) => String(choice?.title || "").includes("inimigo para 4 de dano"), "Milícia enemy-damage choice");
		context.room.send("effect_choice_submit", { choiceId: enemyChoice.choiceId, optionId: "blood-target-leader" });
		await waitFor(() => Number(context.events.state?.game?.p1?.hp || 0) === 27 && Number(context.events.state?.game?.p2?.hp || 0) === 26, "Milícia damage resolution");
		assert(context.events.plays.some((play) => play.cardId === "Aranhas Negras, Milícia" && Number(play.cost) === 3), "Milícia should spend cost 3");
		console.log("[CARD_REVISION] Milícia: custo 3, dano próprio 3 e dano inimigo 4 OK");
	} finally {
		await close(context);
	}
}

async function testLionSearchLimit() {
	const deck = [...repeated("Leão Rei Sagrado", 30), ...repeated("Cervo de Galhos Brancos", 5), ...repeated("Thorn, o Martelo da Montanha", 5)];
	const context = await openSoloMatch("leao", deck, repeated("Thorn, o Martelo da Montanha"));
	try {
		await prepareFragments(context, 6);
		context.room.send("play_card", { cardId: "Leão Rei Sagrado", targetPos: 0, cardKind: "ally" });
		const choice = await waitForChoice(context, (entry) => String(entry?.title || "").includes("aliado Animal do deck"), "Leão deck-search choice");
		const optionCards = choice.options.map((option) => String(option.cardId || option.label || ""));
		assert(optionCards.length > 0, "Leão should offer an Animal from the deck");
		assert(optionCards.every((cardId) => cardId === "Cervo de Galhos Brancos"), `Leão should exclude cost-6 Animal cards: ${JSON.stringify(optionCards)}`);
		context.room.send("effect_choice_submit", { choiceId: choice.choiceId, optionId: choice.options[0].id });
		await waitFor(() => Array.from(context.events.state?.game?.p1?.hand || []).includes("Cervo de Galhos Brancos"), "Leão selected card in hand");
		assert(context.events.plays.some((play) => play.cardId === "Leão Rei Sagrado" && Number(play.cost) === 6), "Leão should spend cost 6");
		console.log("[CARD_REVISION] Leão: busca somente Animal de custo 4 ou menos OK");
	} finally {
		await close(context);
	}
}

async function testPerfectInterruption() {
	const context = await openSoloMatch("interrupcao", repeated("Mãos Flamejantes"), repeated("Interrupção Perfeita"));
	try {
		await prepareFragments(context, 2);
		context.room.send("play_card", { cardId: "Mãos Flamejantes", cardKind: "spell" });
		await waitFor(() => context.events.logs.some((entry) => entry?.effect === "anular_magia_truque" && String(entry?.cardId || "") === "Interrupção Perfeita"), "Interrupção counterspell log");
		assert(Array.from(context.events.state?.game?.p2?.grave || []).includes("Interrupção Perfeita"), "Interrupção should leave the bot hand after countering a spell");
		console.log("[CARD_REVISION] Interrupção Perfeita: reagiu a Magia em partida real OK");
	} finally {
		await close(context);
	}
}

async function testValbrakBotProgress() {
	const context = await openSoloMatch("valbrak-progress", repeated("Thorn, o Martelo da Montanha"), repeated("Miliciano da Vila"));
	try {
		for (let turn = 0; turn < 8; turn += 1) {
			await passP1Turn(context);
			await waitFor(
				() => String(context.events.state?.game?.turnSlot || "") === "p1" && String(context.events.state?.game?.phase || "") === "INITIAL",
				`Valbrak bot turn ${turn + 1}`
			);
		}
		const valbrakDraws = context.events.logs.filter((entry) => entry?.effect === "valbrak");
		assert(valbrakDraws.length > 0, "Valbrak bot should draw after summoning a Cidadão");
		assert(Number(context.events.state?.game?.turn || 0) >= 16, "Valbrak bot should complete eight full turns");
		console.log("[CARD_REVISION] Valbrak: IA completou turnos de Cidadão sem travar OK");
	} finally {
		await close(context);
	}
}

async function main() {
	console.log(`[CARD_REVISION] endpoint=${ENDPOINT}`);
	await testValbrakBotProgress();
	if (process.env.CARD_REVISION_CASE === "valbrak") return;
	await testSacrificeDamage();
	await testLionSearchLimit();
	await testPerfectInterruption();
	console.log("[CARD_REVISION] Todas as partidas de revisão passaram.");
}

main().catch((error) => {
	console.error("[CARD_REVISION] falhou:", error?.stack ?? error);
	process.exit(1);
});