import { MPClient } from "../net/mpClient";

const mp = new MPClient();

const $ = (id: string) => document.getElementById(id) as any;
let selectedCardId: string | null = null;
let myServerReady = false;

function renderReady(ready: boolean) {
	const el = $("ready");
	el.textContent = ready ? "PRONTO" : "NÃO PRONTO";
	el.className = ready ? "ok" : "bad";
}

function syncLoadoutFromUI() {
	const deckId = $("deck").value;
	const leaderId = $("leader").value;
	if (deckId) mp.chooseDeck(deckId);
	if (leaderId) mp.chooseLeader(leaderId);
}

let isJoining = false;
async function joinLobby() {
	if (isJoining) return;
	isJoining = true;
	try {
		const endpoint = $("endpoint").value.trim();
		const roomId = $("roomId").value.trim() || undefined;
		const r = await mp.connect(endpoint, roomId);
		$("roomId").value = r.roomId;
		syncLoadoutFromUI();
	} finally {
		isJoining = false;
	}
}

function log(msg: string, obj?: any) {
	const el = $("log");
	const line = `[${new Date().toLocaleTimeString()}] ${msg} ${obj ? JSON.stringify(obj) : ""}\n`;
	el.textContent = (line + el.textContent).slice(0, 8000);
}

mp.onLog = log;

mp.onLobbyState = (s) => {
	$("phase").textContent = s.phase;
	$("roomIdView").textContent = mp.roomId ?? "—";
	$("slot").textContent = mp.slot ?? "—";

	const me = s.players.find((p) => p.slot === mp.slot);
	myServerReady = !!me?.ready;
	renderReady(myServerReady);

	const list = s.players
		.sort((a, b) => a.slot.localeCompare(b.slot))
		.map((p) => `${p.slot} ${p.ready ? "✅" : "⏳"} deck=${p.deckId || "-"} leader=${p.leaderId || "-"}`)
		.join("\n");

	$("players").textContent = list || "—";
};

mp.onStartMatch = (m) => {
	log("START_MATCH", m);
};

mp.onCardPlayed = (m) => {
	log("CARD_PLAYED", m);
};

mp.onError = (m) => {
	log("ERROR", m);
};

mp.onStateSync = (state) => {
	const g = state?.game;
	if (!g) return;

	const mySlot = mp.slot;
	if (!mySlot) return;

	const pg = mySlot === "p1" ? g.p1 : g.p2;
	if (!pg) return;

	const hand = Array.isArray(pg.hand) ? pg.hand : [];
	$("hand").innerHTML =
		hand
			.map(
				(c: string) =>
					`<button style="margin:4px;padding:6px;cursor:pointer;" data-card="${c}">${c}</button>`
			)
			.join("") || "<div>—</div>";

	[...$("hand").querySelectorAll("button")].forEach((btn: any) => {
		btn.onclick = () => {
			selectedCardId = btn.getAttribute("data-card");
			$("selectedCard").textContent = selectedCardId || "—";
		};
	});
};

$("btnJoin").onclick = joinLobby;

$("deck").onchange = () => mp.chooseDeck($("deck").value);
$("leader").onchange = () => mp.chooseLeader($("leader").value);

$("btnPlay").onclick = () => {
	if (!selectedCardId) return;
	mp.playCard(selectedCardId);
};

$("btnReady").onclick = () => {
	const nextReady = !myServerReady;
	if (nextReady) {
		const deckId = $("deck").value;
		const leaderId = $("leader").value;
		if (!deckId || !leaderId) {
			log("ERROR", { text: "Selecione deck e líder antes de ficar pronto." });
			return;
		}
		syncLoadoutFromUI();
	}
	mp.setReady(nextReady);
};

const initialRoomId = new URLSearchParams(window.location.search).get("roomId")?.trim() || "";
if (initialRoomId) {
	$("roomId").value = initialRoomId;
	joinLobby();
}

