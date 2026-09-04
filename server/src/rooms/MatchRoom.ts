/* Responsibility: in-match room only (turn/phase/actions); no lobby setup logic here. */

import { Room, Client } from "colyseus";
import { randomInt } from "crypto";
import { findCardDef } from "../game/cardCatalog";
import { describeClientDiagnostic } from "../utils/clientDiagnostics";
import { MatchState, MatchPlayerState } from "./schema/MatchState";
import { buildSpectatorSnapshot, disposeSpectatorChannel, publishSpectatorSnapshot, relaySpectatorEvent } from "./spectatorBridge";
import {
	type Slot,
	type AttackTarget,
	type ChoicePayload,
	attack,
	activateLeaderPower,
	endTurn,
	finishMatch,
	getSlotBySession,
	initGame,
	nextPhase,
	resolveOpeningMulligans,
	playCard
} from "./match/matchEngine";

type ReservedSeat = {
	joinToken: string;
	lobbySessionId: string;
	slot: Slot;
	displayName: string;
	avatarId: string;
};

const MULLIGAN_TIMEOUT_MS = 40_000;
const INITIATIVE_TIMEOUT_MS = 40_000;
const INITIATIVE_TIE_DELAY_MS = 1_300;
const INACTIVITY_TIMEOUT_MS = 10 * 60_000;
const RECONNECTION_GRACE_SECONDS = 60;

export class MatchRoom extends Room<MatchState> {
	maxClients = 2;
	private attackedThisTurn: Record<Slot, Set<number>> = { p1: new Set<number>(), p2: new Set<number>() };
	private summonedThisTurn: Record<Slot, Set<number>> = { p1: new Set<number>(), p2: new Set<number>() };
	private triggeredLeaderThisTurn: Record<Slot, Set<string>> = { p1: new Set<string>(), p2: new Set<string>() };
	private choiceSeq = 0;
	private pendingChoices = new Map<string, { sessionId: string; resolve: (optionId: string | null) => void; timeout?: NodeJS.Timeout; optionIds: string[]; multiSelect?: boolean }>();
	private activeChoiceSessionId: string | null = null;
	private inactivityTimeout: NodeJS.Timeout | null = null;
	private mulliganTimeout: NodeJS.Timeout | null = null;
	private initiativeTimeout: NodeJS.Timeout | null = null;
	private initiativeTieTimeout: NodeJS.Timeout | null = null;
	private matchOptions: { p1: any; p2: any } = { p1: null, p2: null };
	private reservedSeatByToken = new Map<string, ReservedSeat>();
	private consumedJoinTokens = new Set<string>();
	private pendingMulligans: Record<Slot, number[] | null> = { p1: null, p2: null };
	private disconnectTimer: NodeJS.Timeout | null = null;
	private reconnectingSlots = new Set<Slot>();

	private sanitizeDisplayName(name: unknown): string {
		return String(name || "").trim().slice(0, 18);
	}

	private sanitizeAvatarId(avatarId: unknown): string {
		const value = String(avatarId || "").trim();
		return ["chosen:valbrak", "chosen:katsu", "chosen:leafae", "chosen:ademais", "filiacao:arcana", "filiacao:marcial", "filiacao:religioso", "filiacao:sombras"].includes(value) ? value : "";
	}

	private safeRun(context: string, fn: () => void, client?: Client) {
		try {
			fn();
		} catch (err: any) {
			console.error(`[ROOM ERROR] room=${this.roomId} context=${context} client=${client?.sessionId || "-"}`, err && (err.stack || err));
			try {
				this.broadcast("server_error", { context, message: String((err && (err as any).message) || "internal_error") });
			} catch (_) {
				// ignore
			}
		}
	}

	private broadcastMatchEvent(name: string, payload: any) {
		this.broadcast(name, payload);
		relaySpectatorEvent(this.roomId, name, payload);
	}

	private publishSpectatorState() {
		publishSpectatorSnapshot(this.roomId, buildSpectatorSnapshot(this.state));
	}

	private sessionIdBySlot(slot: Slot): string | null {
		for (const p of this.state.players.values()) {
			if (p.slot === slot) return p.sessionId;
		}
		return null;
	}

	private clearInactivityTimer() {
		if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
		this.inactivityTimeout = null;
	}

	private clearMulliganTimer(resetDeadline = false) {
		if (this.mulliganTimeout) clearTimeout(this.mulliganTimeout);
		this.mulliganTimeout = null;
		if (resetDeadline) this.state.game.mulliganDeadlineAt = 0;
	}

	private clearInitiativeTimers(resetDeadline = false) {
		if (this.initiativeTimeout) clearTimeout(this.initiativeTimeout);
		if (this.initiativeTieTimeout) clearTimeout(this.initiativeTieTimeout);
		this.initiativeTimeout = null;
		this.initiativeTieTimeout = null;
		if (resetDeadline) this.state.initiativeDeadlineAt = 0;
	}

	private resetInitiativeRound() {
		this.state.initiativeStatus = "ROLLING";
		this.state.p1InitiativeRoll = 0;
		this.state.p2InitiativeRoll = 0;
		this.state.initiativeWinnerSlot = "";
	}

	private startInitiative() {
		if (this.state.phase !== "INITIATIVE" || this.clients.length < 2) return;
		this.clearInitiativeTimers();
		this.resetInitiativeRound();
		this.state.initiativeDeadlineAt = Date.now() + INITIATIVE_TIMEOUT_MS;
		this.initiativeTimeout = setTimeout(() => {
			this.initiativeTimeout = null;
			if (this.state.phase !== "INITIATIVE" || this.state.initiativeStatus !== "ROLLING") return;
			if (!this.state.p1InitiativeRoll) this.state.p1InitiativeRoll = randomInt(1, 21);
			if (!this.state.p2InitiativeRoll) this.state.p2InitiativeRoll = randomInt(1, 21);
			this.resolveInitiativeRoll();
		}, INITIATIVE_TIMEOUT_MS);
	}

	private resolveInitiativeRoll() {
		const p1Roll = this.state.p1InitiativeRoll;
		const p2Roll = this.state.p2InitiativeRoll;
		if (!p1Roll || !p2Roll) return;
		this.clearInitiativeTimers(true);
		if (p1Roll === p2Roll) {
			this.state.initiativeStatus = "TIE";
			this.broadcastMatchEvent("initiative_tie", { roll: p1Roll });
			this.initiativeTieTimeout = setTimeout(() => {
				this.initiativeTieTimeout = null;
				this.startInitiative();
			}, INITIATIVE_TIE_DELAY_MS);
			return;
		}
		const winnerSlot: Slot = p1Roll > p2Roll ? "p1" : "p2";
		this.state.initiativeWinnerSlot = winnerSlot;
		this.state.initiativeStatus = "CHOOSING";
		this.state.initiativeDeadlineAt = Date.now() + INITIATIVE_TIMEOUT_MS;
		this.broadcastMatchEvent("initiative_result", { p1Roll, p2Roll, winnerSlot });
		this.initiativeTimeout = setTimeout(() => {
			this.initiativeTimeout = null;
			if (this.state.phase === "INITIATIVE" && this.state.initiativeStatus === "CHOOSING") this.startOpeningHand(winnerSlot);
		}, INITIATIVE_TIMEOUT_MS);
	}

	private startOpeningHand(starterSlot: Slot) {
		if (this.state.phase !== "INITIATIVE") return;
		this.clearInitiativeTimers(true);
		this.state.initiativeStatus = "RESOLVED";
		this.state.phase = "IN_MATCH";
		initGame(this.state, this.matchOptions.p1, this.matchOptions.p2, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, starterSlot, this.askChoice);
		this.pendingMulligans = { p1: null, p2: null };
		this.startMulliganTimer();
		this.publishSpectatorState();
		this.refreshInactivityTimer();
	}

	private scheduleDisconnect(delayMs = 1200) {
		if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
		this.disconnectTimer = setTimeout(() => {
			this.disconnectTimer = null;
			try { this.disconnect(); } catch (_) {}
		}, delayMs);
	}

	private startMulliganTimer() {
		this.clearMulliganTimer();
		this.state.game.mulliganDeadlineAt = Date.now() + MULLIGAN_TIMEOUT_MS;
		this.mulliganTimeout = setTimeout(() => {
			this.mulliganTimeout = null;
			if (this.state.phase !== "IN_MATCH" || this.state.game.phase !== "MULLIGAN") {
				this.state.game.mulliganDeadlineAt = 0;
				return;
			}
			if (!this.state.game.p1MulliganDone) {
				this.pendingMulligans.p1 = [];
				this.state.game.p1MulliganDone = true;
			}
			if (!this.state.game.p2MulliganDone) {
				this.pendingMulligans.p2 = [];
				this.state.game.p2MulliganDone = true;
			}
			this.tryResolveOpeningMulligan();
			if (this.state.game.phase === "MULLIGAN") this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, MULLIGAN_TIMEOUT_MS);
	}

	private inferChoiceSourceCardId(payload: ChoicePayload): string | undefined {
		const explicit = String(payload?.sourceCardId || "").trim();
		if (explicit) return explicit;
		for (const option of Array.isArray(payload?.options) ? payload.options : []) {
			const candidate = String(option?.cardId || option?.label || "").trim();
			if (candidate && findCardDef(candidate)) return candidate;
		}
		const titleLead = String(payload?.title || "").split(":")[0]?.trim();
		if (titleLead && findCardDef(titleLead)) return titleLead;
		return undefined;
	}

	private resetInactivityTimer(sessionId: string | null) {
		this.clearInactivityTimer();
		if (!sessionId || this.state.phase === "FINISHED" || this.clients.length < 2) return;
		this.inactivityTimeout = setTimeout(() => {
			this.inactivityTimeout = null;
			if (this.state.phase === "FINISHED") return;
			const player = this.state.players.get(sessionId);
			if (!player) return;
			const loser = player.slot === "p1" || player.slot === "p2" ? player.slot as Slot : null;
			if (!loser) return;
			this.activeChoiceSessionId = null;
			finishMatch(this.state, loser, "inactivity", (name, payload) => this.broadcastMatchEvent(name, payload));
			this.publishSpectatorState();
		}, INACTIVITY_TIMEOUT_MS);
	}

	private refreshInactivityTimer() {
		if (this.state.phase === "FINISHED") {
			this.clearInactivityTimer();
			return;
		}
		if (this.state.game.phase === "MULLIGAN") {
			const p1Done = !!this.state.game.p1MulliganDone;
			const p2Done = !!this.state.game.p2MulliganDone;
			if (p1Done === p2Done) {
				this.resetInactivityTimer(null);
				return;
			}
			const waitingSlot: Slot = p1Done ? "p2" : "p1";
			this.resetInactivityTimer(this.sessionIdBySlot(waitingSlot));
			return;
		}
		if (this.activeChoiceSessionId) {
			this.resetInactivityTimer(this.activeChoiceSessionId);
			return;
		}
		const turnSlot = this.state.game.turnSlot;
		const sessionId = turnSlot === "p1" || turnSlot === "p2" ? this.sessionIdBySlot(turnSlot) : null;
		this.resetInactivityTimer(sessionId);
	}

	private autoAdvanceFromInitial() {
		if (this.state.game.phase !== "INITIAL") return;
		if (this.pendingChoices.size > 0) return;
		nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
		this.publishSpectatorState();
		this.refreshInactivityTimer();
	}

	private parseMulliganSelection(rawValue: unknown, handSize: number): number[] | null {
		if (!Array.isArray(rawValue)) return null;
		if (rawValue.length > 5) return null;
		const unique = new Set<number>();
		for (const entry of rawValue) {
			const index = Number(entry);
			if (!Number.isInteger(index) || index < 0 || index >= handSize) return null;
			if (unique.has(index)) return null;
			unique.add(index);
		}
		return Array.from(unique).sort((left, right) => left - right);
	}

	private tryResolveOpeningMulligan() {
		if (!this.state.game.p1MulliganDone || !this.state.game.p2MulliganDone) return;
		this.clearMulliganTimer(true);
		const p1Selection = this.pendingMulligans.p1 || [];
		const p2Selection = this.pendingMulligans.p2 || [];
		resolveOpeningMulligans(
			this.state,
			p1Selection,
			p2Selection,
			(name, payload) => this.broadcastMatchEvent(name, payload),
			this.attackedThisTurn,
			this.summonedThisTurn,
			this.triggeredLeaderThisTurn,
			this.askChoice
		);
		this.pendingMulligans = { p1: null, p2: null };
		this.autoAdvanceFromInitial();
		this.publishSpectatorState();
		this.refreshInactivityTimer();
	}

	private askChoice = (slot: Slot, payload: ChoicePayload, onResolve: (optionId: string | null) => void) => {
		const sessionId = this.sessionIdBySlot(slot);
		if (!sessionId) {
			this.activeChoiceSessionId = null;
			this.refreshInactivityTimer();
			onResolve(null);
			return;
		}
		const timeoutMs = 40_000;
		const choiceId = `choice-${++this.choiceSeq}`;
		const optionIds = (Array.isArray(payload.options) ? payload.options : []).filter((o: any) => !o?.disabled).map((o) => String(o?.id || "")).filter(Boolean);
		const timeout = setTimeout(() => {
			const pending = this.pendingChoices.get(choiceId);
			if (!pending) return;
			this.pendingChoices.delete(choiceId);
			for (const otherClient of this.clients) {
				if (otherClient.sessionId !== sessionId) otherClient.send("choice_waiting_end", { choiceId, waitingFor: slot });
			}
			this.activeChoiceSessionId = null;
			const fallback = pending.multiSelect ? null : (pending.optionIds.length ? pending.optionIds[Math.floor(Math.random() * pending.optionIds.length)] : null);
			pending.resolve(fallback);
			if (!this.activeChoiceSessionId) this.refreshInactivityTimer();
		}, timeoutMs);
		this.pendingChoices.set(choiceId, { sessionId, resolve: onResolve, timeout, optionIds, multiSelect: payload.multiSelect === true });
		const client = this.clients.find((c) => c.sessionId === sessionId);
		if (!client) {
			const pending = this.pendingChoices.get(choiceId);
			if (pending?.timeout) clearTimeout(pending.timeout);
			this.pendingChoices.delete(choiceId);
			this.activeChoiceSessionId = null;
			this.refreshInactivityTimer();
			onResolve(null);
			return;
		}
		this.activeChoiceSessionId = sessionId;
		this.resetInactivityTimer(sessionId);
		for (const otherClient of this.clients) {
			if (otherClient.sessionId !== sessionId) {
				otherClient.send("choice_waiting", { choiceId, waitingFor: slot, title: payload.title, timeoutMs });
			}
		}
		client.send("effect_choice_required", {
			choiceId,
			title: payload.title,
			options: payload.options,
			sourceCardId: this.inferChoiceSourceCardId(payload),
			activatedCardId: payload.activatedCardId,
			attackerId: payload.attackerId,
			attackerName: payload.attackerName,
			attackerAttack: payload.attackerAttack,
			targetCardId: payload.targetCardId,
			targetName: payload.targetName,
			targetResistance: payload.targetResistance,
			targetHp: payload.targetHp,
			targetMaxHp: payload.targetMaxHp,
			allowCancel: payload.allowCancel !== false,
			multiSelect: payload.multiSelect === true,
			submitLabel: payload.submitLabel,
			minSelections: payload.minSelections,
			maxSelections: payload.maxSelections,
			timeoutMs
		});
	};

	private getReservedSeat(options: any, auth?: ReservedSeat | null): ReservedSeat | null {
		if (auth?.joinToken && (auth.slot === "p1" || auth.slot === "p2")) return auth;
		const joinToken = String(options?.joinToken || "").trim();
		return this.reservedSeatByToken.get(joinToken) || null;
	}

	onAuth(_client: Client, options: any) {
		const joinToken = String(options?.joinToken || "").trim();
		const reservedSeat = this.reservedSeatByToken.get(joinToken);
		if (!reservedSeat) throw new Error("invalid_match_join_token");
		if (this.consumedJoinTokens.has(joinToken)) throw new Error("match_join_token_already_used");
		return reservedSeat;
	}

	onCreate(options: any) {
		try {
			this.setState(new MatchState());
			this.matchOptions = { p1: options?.p1, p2: options?.p2 };
			this.state.phase = "INITIATIVE";
			this.state.game.phase = "INITIATIVE";
		const reservations = Array.isArray(options?.seatReservations) ? options.seatReservations : [];
		const p1Reservation = reservations.find((reservation: any) => reservation?.slot === "p1");
		const p2Reservation = reservations.find((reservation: any) => reservation?.slot === "p2");
		this.setMetadata({
			title: `${String(p1Reservation?.displayName || "Jogador 1")} vs ${String(p2Reservation?.displayName || "Jogador 2")}`,
			p1Name: String(p1Reservation?.displayName || "Jogador 1"),
			p2Name: String(p2Reservation?.displayName || "Jogador 2"),
			p1LeaderId: String(options?.p1?.leaderId || ""),
			p2LeaderId: String(options?.p2?.leaderId || "")
		});
		for (const reservation of Array.isArray(options?.seatReservations) ? options.seatReservations : []) {
			const joinToken = String(reservation?.joinToken || "").trim();
			const lobbySessionId = String(reservation?.lobbySessionId || "").trim();
			if (!joinToken || !lobbySessionId) continue;
			this.reservedSeatByToken.set(joinToken, {
				joinToken,
				lobbySessionId,
				slot: reservation?.slot === "p2" ? "p2" : "p1",
				displayName: this.sanitizeDisplayName(reservation?.displayName),
				avatarId: this.sanitizeAvatarId(reservation?.avatarId)
			});
		}
		this.onMessage("submit_mulligan", (client, msg: { indices?: number[] }) => this.safeRun("submit_mulligan", () => {
			if (this.state.phase !== "IN_MATCH" || this.state.game.phase !== "MULLIGAN") return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot) return;
			for (const pending of this.pendingChoices.values()) {
				if (pending.sessionId === client.sessionId) return;
			}
			if ((slot === "p1" && this.state.game.p1MulliganDone) || (slot === "p2" && this.state.game.p2MulliganDone)) {
				client.send("error", { message: "mulligan_already_submitted" });
				return;
			}
			const player = slot === "p1" ? this.state.game.p1 : this.state.game.p2;
			const selection = this.parseMulliganSelection(msg?.indices, player.hand.length);
			if (!selection) {
				client.send("error", { message: "invalid_mulligan_selection" });
				return;
			}
			this.pendingMulligans[slot] = selection;
			if (slot === "p1") this.state.game.p1MulliganDone = true;
			else this.state.game.p2MulliganDone = true;
			this.tryResolveOpeningMulligan();
			if (this.state.game.phase === "MULLIGAN") this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, client));

		this.onMessage("roll_initiative", (client) => this.safeRun("roll_initiative", () => {
			if (this.state.phase !== "INITIATIVE" || this.state.initiativeStatus !== "ROLLING") return;
			const playerSlot = getSlotBySession(this.state, client.sessionId);
			if (!playerSlot) return;
			if (playerSlot === "p1" && this.state.p1InitiativeRoll) return;
			if (playerSlot === "p2" && this.state.p2InitiativeRoll) return;
			if (playerSlot === "p1") this.state.p1InitiativeRoll = randomInt(1, 21);
			else this.state.p2InitiativeRoll = randomInt(1, 21);
			this.resolveInitiativeRoll();
		}, client));

		this.onMessage("choose_starter", (client, msg: { starterSlot?: string }) => this.safeRun("choose_starter", () => {
			if (this.state.phase !== "INITIATIVE" || this.state.initiativeStatus !== "CHOOSING") return;
			const winnerSlot = this.state.initiativeWinnerSlot === "p2" ? "p2" : "p1";
			if (getSlotBySession(this.state, client.sessionId) !== winnerSlot) return;
			const starterSlot: Slot = msg?.starterSlot === "p2" ? "p2" : "p1";
			this.startOpeningHand(starterSlot);
		}, client));

		this.onMessage("next_phase", (client) => this.safeRun("next_phase", () => {
			if (!this.isValidTurnAction(client, ["INITIAL", "PREP", "COMBAT"])) return;
			nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
			this.publishSpectatorState();
			if (this.state.phase === "INITIATIVE" && this.clients.length === 2 && this.state.initiativeStatus === "WAITING") this.startInitiative();
			this.refreshInactivityTimer();
		}, client));

		this.onMessage("end_turn", (client) => this.safeRun("end_turn", () => {
			if (!this.isValidTurnAction(client, ["END"])) return;
			endTurn(this.state, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.autoAdvanceFromInitial();
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, client));

		this.onMessage("concede", (client) => this.safeRun("concede", () => {
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot || this.state.phase === "FINISHED") return;
			finishMatch(this.state, slot, "concede", (name, payload) => this.broadcastMatchEvent(name, payload));
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, client));

		this.onMessage("play_card", (client, msg: { cardId?: string; targetPos?: number; cardKind?: string }) => this.safeRun("play_card", () => {
			if (!this.isValidTurnAction(client, ["PREP"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			const cardId = String(msg?.cardId || "");
			const targetPos = Number(msg?.targetPos);
			const cardKind = String(msg?.cardKind || "");
			if (!slot || !cardId) return;
			playCard(this.state, slot, cardId, Number.isInteger(targetPos) ? targetPos : undefined, cardKind, (name, payload) => this.broadcastMatchEvent(name, payload), this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, client));

		this.onMessage("leader_power", (client) => this.safeRun("leader_power", () => {
			if (!this.isValidTurnAction(client, ["PREP"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot) return;
			activateLeaderPower(this.state, slot, (name, payload) => this.broadcastMatchEvent(name, payload), this.askChoice);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, client));

		this.onMessage("effect_choice_submit", (client, msg: { choiceId?: string; optionId?: string | null }) => this.safeRun("effect_choice_submit", () => {
			const choiceId = String(msg?.choiceId || "");
			if (!choiceId) return;
			const pending = this.pendingChoices.get(choiceId);
			if (!pending) return;
			if (pending.sessionId !== client.sessionId) return;
			this.pendingChoices.delete(choiceId);
			if (pending.timeout) clearTimeout(pending.timeout);
			for (const otherClient of this.clients) {
				if (otherClient.sessionId !== client.sessionId) otherClient.send("choice_waiting_end", { choiceId });
			}
			this.activeChoiceSessionId = null;
			const optionId = msg?.optionId == null ? null : String(msg.optionId);
			pending.resolve(optionId);
			this.autoAdvanceFromInitial();
			this.publishSpectatorState();
			if (!this.activeChoiceSessionId) this.refreshInactivityTimer();
		}, client));

		this.onMessage("attack", (client, msg: { attackerPos?: number; attackerLeader?: boolean; target?: string; targetPos?: number }) => this.safeRun("attack", () => {
			if (!this.isValidTurnAction(client, ["COMBAT"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot) return;
			const attackerLeader = msg?.attackerLeader === true;
			if (attackerLeader) return;
			const attackerPos = attackerLeader ? -1 : Number(msg?.attackerPos);
			if (!attackerLeader && (!Number.isInteger(attackerPos) || attackerPos < 0)) return;
			const rawTarget = String(msg?.target || "leader");
			const target: AttackTarget = rawTarget === "ally" ? { type: "ally", targetPos: Number(msg?.targetPos) } : { type: "leader" };
			if (target.type === "ally" && (!Number.isInteger(target.targetPos) || target.targetPos < 0)) return;
			attack(this.state, slot, attackerPos, target, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		}, client));
        
		this.onMessage("set_name", (client, msg: { name?: string; avatarId?: string }) => {
			const p = this.state.players.get(client.sessionId);
			if (!p) return;
			p.displayName = this.sanitizeDisplayName(msg?.name);
			p.avatarId = this.sanitizeAvatarId(msg?.avatarId);
			this.publishSpectatorState();
		});

		this.onMessage("request_connection_status", (client) => this.safeRun("request_connection_status", () => {
			const ownSlot = getSlotBySession(this.state, client.sessionId);
			const opponentSlot: Slot | null = ownSlot === "p1" ? "p2" : ownSlot === "p2" ? "p1" : null;
			if (opponentSlot && this.reconnectingSlots.has(opponentSlot)) {
				client.send("opponent_reconnecting", { slot: opponentSlot, graceSeconds: RECONNECTION_GRACE_SECONDS });
			}
		}, client));
		} catch (err: any) {
			console.error(`[ROOM ERROR] room=${this.roomId} onCreate`, err && (err.stack || err));
			throw err;
		}
	}

	onJoin(client: Client, options?: any, auth?: ReservedSeat) {
		try {
			const reservedSeat = this.getReservedSeat(options, auth);
			if (!reservedSeat) throw new Error("missing_reserved_seat");
			const player = new MatchPlayerState();
			player.sessionId = client.sessionId;
			player.slot = reservedSeat.slot;
			player.displayName = reservedSeat.displayName;
			player.avatarId = reservedSeat.avatarId;
			this.state.players.set(client.sessionId, player);
			this.consumedJoinTokens.add(reservedSeat.joinToken);
			if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
			client.send("assign_slot", { slot: player.slot, sessionId: client.sessionId });
			console.log(`[MATCH] joined room=${this.roomId} client=${client.sessionId} slot=${player.slot} phase=${this.state.phase} gamePhase=${this.state.game.phase} turn=${this.state.game.turn} turnSlot=${this.state.game.turnSlot} clients=${this.clients.length}`);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		} catch (err: any) {
			console.error(`[ROOM ERROR] room=${this.roomId} onJoin client=${client?.sessionId || "-"}`, err && (err.stack || err));
			try { client.send("server_error", { message: "join_failed" }); } catch (_) {}
		}
	}

	async onLeave(client: Client, consented?: boolean) {
		try {
			const leavingPlayer = this.state.players.get(client.sessionId);
			const leavingSlot = leavingPlayer?.slot === "p1" || leavingPlayer?.slot === "p2" ? leavingPlayer.slot as Slot : null;
			const clientDiagnostic = describeClientDiagnostic(this.roomId, client.sessionId);
			console.log(`[MATCH] leave room=${this.roomId} client=${client.sessionId} slot=${leavingSlot || "-"} consented=${consented === true} phase=${this.state.phase} gamePhase=${this.state.game.phase} turn=${this.state.game.turn} turnSlot=${this.state.game.turnSlot} clients=${this.clients.length} ${clientDiagnostic}`);
			if (!consented && leavingSlot && this.state.phase !== "FINISHED") {
				this.reconnectingSlots.add(leavingSlot);
				this.broadcast("opponent_reconnecting", { slot: leavingSlot, graceSeconds: RECONNECTION_GRACE_SECONDS });
				try {
					console.log(`[MATCH] waiting reconnect room=${this.roomId} client=${client.sessionId} slot=${leavingSlot} grace=${RECONNECTION_GRACE_SECONDS}s`);
					await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
					this.reconnectingSlots.delete(leavingSlot);
					for (const connectedClient of this.clients) {
						if (connectedClient.sessionId !== client.sessionId) {
							connectedClient.send("opponent_reconnected", { slot: leavingSlot });
						}
					}
					console.log(`[MATCH] reconnected room=${this.roomId} client=${client.sessionId} slot=${leavingSlot} phase=${this.state.phase} gamePhase=${this.state.game.phase} turn=${this.state.game.turn} turnSlot=${this.state.game.turnSlot} clients=${this.clients.length}`);
					this.publishSpectatorState();
					this.refreshInactivityTimer();
					return;
				} catch (error) {
					this.reconnectingSlots.delete(leavingSlot);
					console.log(`[MATCH] reconnect expired room=${this.roomId} client=${client.sessionId} slot=${leavingSlot} phase=${this.state.phase} gamePhase=${this.state.game.phase} turn=${this.state.game.turn} turnSlot=${this.state.game.turnSlot} clients=${this.clients.length}`);
				}
			}
			const remainingPlayers = [...this.state.players.values()].filter((player) => player.sessionId !== client.sessionId);
			for (const [id, pending] of this.pendingChoices.entries()) {
				if (pending.sessionId === client.sessionId) {
					this.pendingChoices.delete(id);
					if (pending.timeout) clearTimeout(pending.timeout);
					pending.resolve(null);
				}
			}
			if (this.activeChoiceSessionId === client.sessionId) this.activeChoiceSessionId = null;
			if (leavingSlot && this.state.phase !== "FINISHED" && remainingPlayers.length > 0) {
				finishMatch(this.state, leavingSlot, "opponent_left", (name, payload) => this.broadcastMatchEvent(name, payload));
				this.scheduleDisconnect(1800);
			}
			this.clearInactivityTimer();
			this.state.players.delete(client.sessionId);
			if (this.state.hostSessionId === client.sessionId) {
				const first = [...this.state.players.values()][0];
				this.state.hostSessionId = first?.sessionId || "";
			}
			this.publishSpectatorState();
			if (remainingPlayers.length === 0) this.scheduleDisconnect(100);
			this.refreshInactivityTimer();
		} catch (err: any) {
			console.error(`[ROOM ERROR] room=${this.roomId} onLeave client=${client?.sessionId || "-"}`, err && (err.stack || err));
		}
	}

	onDispose() {
		try {
			this.clearMulliganTimer(true);
			this.clearInitiativeTimers(true);
			this.clearInactivityTimer();
			this.reconnectingSlots.clear();
			if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
			this.disconnectTimer = null;
			// ensure spectator channel disposed
			try { disposeSpectatorChannel(this.roomId); } catch (_) {}
			console.log(`[ROOM] disposed room=${this.roomId}`);
		} catch (err: any) {
			console.error(`[ROOM ERROR] room=${this.roomId} onDispose`, err && (err.stack || err));
		}
	}

	private isValidTurnAction(client: Client, phases: string[]) {
		if (this.state.phase !== "IN_MATCH") return false;
		const slot = getSlotBySession(this.state, client.sessionId);
		if (!slot) return false;
		if (this.state.game.turnSlot !== slot) return false;
		for (const pending of this.pendingChoices.values()) {
			if (pending.sessionId === client.sessionId) return false;
		}
		if (!phases.includes(this.state.game.phase)) return false;
		return true;
	}
}

