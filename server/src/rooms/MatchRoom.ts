/* Responsibility: in-match room only (turn/phase/actions); no lobby setup logic here. */

import { Room, Client } from "colyseus";
import { findCardDef } from "../game/cardCatalog";
import { MatchState, MatchPlayerState } from "./schema/MatchState";
import { buildSpectatorSnapshot, publishSpectatorSnapshot, relaySpectatorEvent } from "./spectatorBridge";
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
	playCard
} from "./match/matchEngine";

type ReservedSeat = {
	joinToken: string;
	lobbySessionId: string;
	slot: Slot;
	displayName: string;
};

export class MatchRoom extends Room<MatchState> {
	maxClients = 2;
	private attackedThisTurn: Record<Slot, Set<number>> = { p1: new Set<number>(), p2: new Set<number>() };
	private summonedThisTurn: Record<Slot, Set<number>> = { p1: new Set<number>(), p2: new Set<number>() };
	private triggeredLeaderThisTurn: Record<Slot, Set<string>> = { p1: new Set<string>(), p2: new Set<string>() };
	private choiceSeq = 0;
	private pendingChoices = new Map<string, { sessionId: string; resolve: (optionId: string | null) => void; timeout?: NodeJS.Timeout; optionIds: string[]; multiSelect?: boolean }>();
	private activeChoiceSessionId: string | null = null;
	private inactivityTimeout: NodeJS.Timeout | null = null;
	private reservedSeatByToken = new Map<string, ReservedSeat>();
	private consumedJoinTokens = new Set<string>();

	private sanitizeDisplayName(name: unknown): string {
		return String(name || "").trim().slice(0, 18);
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
		}, 80_000);
	}

	private refreshInactivityTimer() {
		if (this.state.phase === "FINISHED") {
			this.clearInactivityTimer();
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

	private askChoice = (slot: Slot, payload: ChoicePayload, onResolve: (optionId: string | null) => void) => {
		const sessionId = this.sessionIdBySlot(slot);
		if (!sessionId) {
			this.activeChoiceSessionId = null;
			this.refreshInactivityTimer();
			onResolve(null);
			return;
		}
		const timeoutMs = 20_000;
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
		this.setState(new MatchState());
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
				displayName: this.sanitizeDisplayName(reservation?.displayName)
			});
		}
		const starterSlot: Slot = options?.starterSlot === "p2" ? "p2" : "p1";
		initGame(this.state, options?.p1, options?.p2, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, starterSlot, this.askChoice);
		this.publishSpectatorState();

		this.onMessage("next_phase", (client) => {
			if (!this.isValidTurnAction(client, ["INITIAL", "PREP", "COMBAT"])) return;
			nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		});

		this.onMessage("end_turn", (client) => {
			if (!this.isValidTurnAction(client, ["END"])) return;
			endTurn(this.state, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		});

		this.onMessage("play_card", (client, msg: { cardId?: string; targetPos?: number; cardKind?: string }) => {
			if (!this.isValidTurnAction(client, ["PREP"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			const cardId = String(msg?.cardId || "");
			const targetPos = Number(msg?.targetPos);
			const cardKind = String(msg?.cardKind || "");
			if (!slot || !cardId) return;
			playCard(this.state, slot, cardId, Number.isInteger(targetPos) ? targetPos : undefined, cardKind, (name, payload) => this.broadcastMatchEvent(name, payload), this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		});

		this.onMessage("leader_power", (client) => {
			if (!this.isValidTurnAction(client, ["PREP"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot) return;
			activateLeaderPower(this.state, slot, (name, payload) => this.broadcastMatchEvent(name, payload), this.askChoice);
			this.publishSpectatorState();
			this.refreshInactivityTimer();
		});

		this.onMessage("effect_choice_submit", (client, msg: { choiceId?: string; optionId?: string | null }) => {
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
			this.publishSpectatorState();
			if (!this.activeChoiceSessionId) this.refreshInactivityTimer();
		});

		this.onMessage("attack", (client, msg: { attackerPos?: number; attackerLeader?: boolean; target?: string; targetPos?: number }) => {
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
		});
        
		this.onMessage("set_name", (client, msg: { name?: string }) => {
			const p = this.state.players.get(client.sessionId);
			if (!p) return;
			p.displayName = this.sanitizeDisplayName(msg?.name);
			this.publishSpectatorState();
		});
	}

	onJoin(client: Client, options?: any, auth?: ReservedSeat) {
		const reservedSeat = this.getReservedSeat(options, auth);
		if (!reservedSeat) throw new Error("missing_reserved_seat");
		const player = new MatchPlayerState();
		player.sessionId = client.sessionId;
		player.slot = reservedSeat.slot;
		player.displayName = reservedSeat.displayName;
		this.state.players.set(client.sessionId, player);
		this.consumedJoinTokens.add(reservedSeat.joinToken);
		if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
		client.send("assign_slot", { slot: player.slot, sessionId: client.sessionId });
		this.publishSpectatorState();
		this.refreshInactivityTimer();
	}

	onLeave(client: Client) {
		const leavingPlayer = this.state.players.get(client.sessionId);
		const leavingSlot = leavingPlayer?.slot === "p1" || leavingPlayer?.slot === "p2" ? leavingPlayer.slot as Slot : null;
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
		}
		this.clearInactivityTimer();
		this.state.players.delete(client.sessionId);
		if (this.state.hostSessionId === client.sessionId) {
			const first = [...this.state.players.values()][0];
			this.state.hostSessionId = first?.sessionId || "";
		}
		this.publishSpectatorState();
		this.refreshInactivityTimer();
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

