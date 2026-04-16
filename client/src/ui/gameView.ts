/* Responsibility: DOM-only helpers for match screen. No Colyseus/network code here. */

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

export function getGameInputs() {
	return {
		endpointEl: byId<HTMLInputElement>("endpoint"),
		roomIdEl: byId<HTMLInputElement>("roomId"),
		btnJoin: byId<HTMLButtonElement>("btnJoin"),
		btnPlay: byId<HTMLButtonElement>("btnPlay"),
		btnLeaderPower: byId<HTMLButtonElement>("btnLeaderPower"),
		btnAttack: byId<HTMLButtonElement>("btnAttack"),
		btnTargetLeader: byId<HTMLButtonElement>("btnTargetLeader"),
		btnNextPhase: byId<HTMLButtonElement>("btnNextPhase"),
		btnEndTurn: byId<HTMLButtonElement>("btnEndTurn"),
		btnBackLobby: byId<HTMLButtonElement>("btnBackLobby"),
		turnPhaseEl: byId("turnPhase"),
		roomIdViewEl: byId("roomIdView"),
		slotEl: byId("slot"),
		turnEl: byId("turn"),
		turnSlotEl: byId("turnSlot"),
		p1HpEl: byId("p1Hp"),
		p2HpEl: byId("p2Hp"),
		p1FragmentsEl: byId("p1Fragments"),
		p2FragmentsEl: byId("p2Fragments"),
		p1HandCountEl: byId("p1HandCount"),
		p2HandCountEl: byId("p2HandCount"),
		handEl: byId("hand"),
		myFieldEl: byId("myField"),
		enemyFieldEl: byId("enemyField"),
		selectedCardEl: byId("selectedCard"),
		selectedAttackerEl: byId("selectedAttacker"),
		selectedTargetEl: byId("selectedTarget"),
		logEl: byId("log")
	};
}

export function log(msg: string, obj?: unknown) {
	const logEl = byId("log");
	if (!logEl) return;
	if (msg === "ASSIGN_SLOT" || msg === "JOINED") return;
	const payload = obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
	const text = typeof payload?.text === "string" ? payload.text.trim() : "";
	if (msg === "ERROR" && text) {
		logText(text);
		return;
	}
	if (msg === "DISCONNECTED" && text) {
		logText(text);
		return;
	}
	if ((msg === "EFFECT" || msg === "HIT" || msg === "MISS") && text) {
		logText(text);
		return;
	}
	return;
}

export function logText(text: string) {
	const logEl = byId("log");
	if (!logEl) return;
	const safe = String(text || "").trim();
	if (!safe) return;
	if (!logEl.dataset.enhanced) {
		logEl.textContent = "";
		logEl.dataset.enhanced = "true";
	}
	const line = document.createElement("div");
	line.className = "log-line";
	line.textContent = safe;
	if (/^[⚔️✨🌍🏁🔄🧩⏳]/u.test(safe) || /vencedor|ativou|atacou|turno de/i.test(safe)) {
		line.classList.add("log-highlight");
	}
	logEl.prepend(line);
	while (logEl.childElementCount > 80) {
		logEl.lastElementChild?.remove();
	}
}

export function renderButtonRow(
	containerId: "hand" | "myField" | "enemyField",
	labels: string[],
	activeIndex: number | null,
	activeStyle: string,
	onClick: (index: number) => void
) {
	const container = byId(containerId);
	if (!container) return;
	container.innerHTML =
		labels
			.map((label, index) => {
				const isActive = activeIndex === index;
				const extraStyle = isActive ? activeStyle : "";
				return `<button style="margin:4px;padding:6px;cursor:pointer;${extraStyle}" data-pos="${index}">${label}</button>`;
			})
			.join("") || "<div>—</div>";

	for (const button of Array.from(container.querySelectorAll("button"))) {
		(button as HTMLButtonElement).onclick = () => {
			const index = Number((button as HTMLButtonElement).getAttribute("data-pos"));
			if (Number.isInteger(index) && index >= 0) onClick(index);
		};
	}
}
