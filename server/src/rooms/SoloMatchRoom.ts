import { Room, Client } from "colyseus";
import { findCardDef } from "../game/cardCatalog";
import { MatchState, MatchPlayerState } from "./schema/MatchState";
import {
	type Slot,
	type AttackTarget,
	type ChoicePayload,
	attack,
	activateLeaderPower,
	canAttackServer,
	endTurn,
	finishMatch,
	getSlotBySession,
	initGame,
	nextPhase,
	resolveOpeningMulligans,
	playCard
} from "./match/matchEngine";

type ChoiceOptionLike = {
	id?: string;
	label?: string;
	side?: string;
	pos?: number;
	cardId?: string;
	disabled?: boolean;
};

type BotPlayCandidate = {
	cardId: string;
	def: ReturnType<typeof findCardDef>;
	score: number;
	cost: number;
};

type ReservedSeat = {
	joinToken: string;
	lobbySessionId: string;
	slot: Slot;
	displayName: string;
};

type SoloBotConfig = {
	displayName: string;
	leaderId: string;
	deckId: string;
	cards?: string[];
	accessories?: {
		sleeve?: string;
		playmat?: string;
	};
};

const MULLIGAN_TIMEOUT_MS = 40_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60_000;
const RECONNECTION_GRACE_SECONDS = 20;

export class SoloMatchRoom extends Room<MatchState> {
	maxClients = 1;
	private attackedThisTurn: Record<Slot, Set<number>> = { p1: new Set<number>(), p2: new Set<number>() };
	private summonedThisTurn: Record<Slot, Set<number>> = { p1: new Set<number>(), p2: new Set<number>() };
	private triggeredLeaderThisTurn: Record<Slot, Set<string>> = { p1: new Set<string>(), p2: new Set<string>() };
	private choiceSeq = 0;
	private pendingChoices = new Map<string, { sessionId: string; resolve: (optionId: string | null) => void; timeout?: NodeJS.Timeout; optionIds: string[]; multiSelect?: boolean }>();
	private activeChoiceSessionId: string | null = null;
	private inactivityTimeout: NodeJS.Timeout | null = null;
	private botTurnTimer: NodeJS.Timeout | null = null;
	private mulliganTimeout: NodeJS.Timeout | null = null;
	private reservedSeat: ReservedSeat | null = null;
	private consumedJoinToken = false;
	private pendingMulligans: Record<Slot, number[] | null> = { p1: null, p2: null };
	private bot: SoloBotConfig = {
		displayName: "IA",
		leaderId: "Valbrak, O Mago Popular",
		deckId: "solo-bot-default",
		cards: []
	};

	private sanitizeDisplayName(name: unknown): string {
		return String(name || "").trim().slice(0, 18);
	}

	private clearBotTimer() {
		if (this.botTurnTimer) clearTimeout(this.botTurnTimer);
		this.botTurnTimer = null;
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
			this.tryResolveOpeningMulligan();
			this.refreshInactivityTimer();
		}, MULLIGAN_TIMEOUT_MS);
	}

	private broadcastMatchEvent(name: string, payload: any) {
		this.broadcast(name, payload);
	}

	private sessionIdBySlot(slot: Slot): string | null {
		for (const player of this.state.players.values()) {
			if (player.slot === slot) return player.sessionId;
		}
		return null;
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

	private normalizeText(value: unknown): string {
		return String(value || "")
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.trim();
	}

	private cardHasKeyword(def: ReturnType<typeof findCardDef>, keyword: string): boolean {
		const probe = this.normalizeText(keyword);
		return Array.isArray(def?.keywords)
			&& def.keywords.some((entry) => this.normalizeText(entry) === probe);
	}

	private cardHasEffect(def: ReturnType<typeof findCardDef>, effectId: string): boolean {
		return this.normalizeText(def?.effect) === this.normalizeText(effectId)
			|| this.normalizeText(def?.effectA) === this.normalizeText(effectId)
			|| this.normalizeText(def?.effectB) === this.normalizeText(effectId);
	}

	private cardMatches(def: ReturnType<typeof findCardDef>, probe: string): boolean {
		const normalizedProbe = this.normalizeText(probe);
		if (!normalizedProbe) return false;
		const source = [def?.name, def?.kind, def?.tipo, def?.classe, def?.filiacao]
			.map((value) => this.normalizeText(value))
			.join(" ");
		return source.includes(normalizedProbe);
	}

	private getUnitAttack(cardId: string): number {
		const def = findCardDef(cardId);
		return Math.max(0, Number(def?.damage ?? def?.atkBonus ?? 0));
	}

	private getUnitResistance(cardId: string): number {
		const def = findCardDef(cardId);
		return Math.max(0, Number(def?.ac ?? 0));
	}

	private getEnemyThreatStats() {
		const enemy = this.state.game.p1 as any;
		let untappedThreat = 0;
		let dangerousUnits = 0;
		let blockers = 0;
		for (let pos = 0; pos < enemy.field.length; pos += 1) {
			const cardId = String(enemy.field[pos] || "");
			if (!cardId) continue;
			const def = findCardDef(cardId);
			const attack = this.getUnitAttack(cardId);
			if (!enemy.fieldTapped?.[pos]) {
				untappedThreat += attack;
				dangerousUnits += attack >= 3 ? 1 : 0;
			}
			if (this.cardHasKeyword(def, "bloquear") || this.cardHasKeyword(def, "provocar")) blockers += 1;
		}
		return { untappedThreat, dangerousUnits, blockers };
	}

	private hasStrongReactiveTrick(): boolean {
		const player = this.state.game.p2 as any;
		return [...player.hand].some((cardId: string) => {
			const def = findCardDef(cardId);
			const kind = this.normalizeText(def?.kind || def?.tipo);
			if (kind !== "truque") return false;
			const cost = Number(def?.cost || 0);
			return cost <= Number(player.fragments || 0);
		});
	}

	private shouldReserveFragments(cost: number): boolean {
		const player = this.state.game.p2 as any;
		const remaining = Number(player.fragments || 0) - cost;
		if (remaining < 2) return false;
		const { untappedThreat } = this.getEnemyThreatStats();
		return this.hasStrongReactiveTrick() && untappedThreat <= Number(player.hp || 0) / 4;
	}

	private isValbrakCitizenArchetype(): boolean {
		return this.normalizeText(this.state.game.p2?.leaderId || "").includes("valbrak");
	}

	private isKatsuArchetype(): boolean {
		return this.normalizeText(this.state.game.p2?.leaderId || "").includes("katsu");
	}

	private isAdemaisArchetype(): boolean {
		return this.normalizeText(this.state.game.p2?.leaderId || "").includes("ademais");
	}

	private isLeafaeArchetype(): boolean {
		return this.normalizeText(this.state.game.p2?.leaderId || "").includes("leafae");
	}

	private isMarcialLeader(): boolean {
		return this.cardMatches(findCardDef(this.state.game.p2?.leaderId || ""), "marcial");
	}

	private isWarriorCard(def: ReturnType<typeof findCardDef>): boolean {
		return this.cardMatches(def, "guerreiro");
	}

	private isMarcialCard(def: ReturnType<typeof findCardDef>): boolean {
		return this.cardMatches(def, "marcial");
	}

	private isBlackSpidersCard(def: ReturnType<typeof findCardDef>, cardId = ""): boolean {
		const name = this.normalizeText(def?.name || cardId);
		return name.includes("aranhas negras");
	}

	private countBlackSpidersProfile() {
		const player = this.state.game.p2 as any;
		let field = 0;
		let ready = 0;
		let hand = 0;
		for (let pos = 0; pos < player.field.length; pos += 1) {
			const cardId = String(player.field[pos] || "");
			if (!cardId) continue;
			const def = findCardDef(cardId);
			if (!this.isBlackSpidersCard(def, cardId)) continue;
			field += 1;
			if (this.canConvertAttackThisTurn(cardId, pos)) ready += 1;
		}
		for (const cardId of [...player.hand] as string[]) {
			if (!cardId) continue;
			if (this.isBlackSpidersCard(findCardDef(cardId), cardId)) hand += 1;
		}
		return { field, ready, hand };
	}

	private countLowCostPlayable(limit: number): number {
		const player = this.state.game.p2 as any;
		return [...player.hand].filter((cardId: string) => {
			const def = findCardDef(cardId);
			return !!cardId && Number(def?.cost || 0) <= limit;
		}).length;
	}

	private chooseBotOpeningMulligan(): number[] {
		const player = this.state.game.p2 as any;
		const hand = [...player.hand] as string[];
		if (!hand.length) return [];

		const evaluated = hand.map((cardId, index) => {
			const def = findCardDef(cardId);
			const cost = Math.max(0, Number(def?.cost || 0));
			const kind = this.normalizeText(def?.kind || def?.tipo);
			const effect = this.normalizeText(def?.effect || "");
			let keepScore = this.scoreBotCard(cardId, def);

			if (cost <= 2) keepScore += 30;
			else if (cost === 3) keepScore += 16;
			else if (cost >= 5) keepScore -= 20;
			if (cost >= 7) keepScore -= 36;

			if (kind === "truque") keepScore -= 18;
			if (kind === "env") keepScore -= 10;
			if (effect === "search_deck" || effect === "charlatao_da_vila" || effect === "informante_beco" || effect === "aranhas_observadora") {
				keepScore += 12;
			}

			return { index, cardId, cost, kind, keepScore };
		});

		const earlyCards = evaluated
			.filter((entry) => entry.cost <= 3 && entry.kind !== "truque")
			.sort((left, right) => right.keepScore - left.keepScore);
		const keepIndexes = new Set<number>();
		const targetEarlyKeeps = earlyCards.length >= 2 ? 2 : earlyCards.length;
		for (let i = 0; i < targetEarlyKeeps; i += 1) {
			keepIndexes.add(earlyCards[i].index);
		}

		const bestOverall = [...evaluated].sort((left, right) => right.keepScore - left.keepScore)[0];
		if (bestOverall) keepIndexes.add(bestOverall.index);

		let selection = evaluated
			.filter((entry) => {
				if (keepIndexes.has(entry.index)) return false;
				if (entry.cost >= 6) return true;
				if (entry.cost >= 5 && earlyCards.length < 2) return true;
				if (entry.kind === "truque" && earlyCards.length === 0) return true;
				return entry.keepScore < 20;
			})
			.map((entry) => entry.index)
			.sort((left, right) => left - right);

		if (!selection.length && earlyCards.length === 0) {
			selection = [...evaluated]
				.sort((left, right) => {
					if (left.keepScore !== right.keepScore) return left.keepScore - right.keepScore;
					if (right.cost !== left.cost) return right.cost - left.cost;
					return left.index - right.index;
				})
				.slice(0, Math.max(1, Math.min(2, evaluated.length - 1)))
				.map((entry) => entry.index)
				.sort((left, right) => left - right);
		}

		if (selection.length >= evaluated.length) {
			selection = selection.slice(0, evaluated.length - 1);
		}

		return selection;
	}

	private countAnimalProfile() {
		return this.countFriendlyCombatProfile((def) => this.cardMatches(def, "animal"));
	}

	private getUnitCurrentHp(pos: number): number {
		const player = this.state.game.p2 as any;
		return Math.max(0, Number(player.fieldHp?.[pos] || 0));
	}

	private getUnitMaxHp(cardId: string): number {
		const def = findCardDef(cardId);
		return Math.max(0, Number(def?.maxHp ?? def?.hp ?? 0));
	}

	private countFriendlyCombatProfile(filter: (def: ReturnType<typeof findCardDef>) => boolean) {
		const player = this.state.game.p2 as any;
		let field = 0;
		let ready = 0;
		let hand = 0;
		for (let pos = 0; pos < player.field.length; pos += 1) {
			const cardId = String(player.field[pos] || "");
			if (!cardId) continue;
			const def = findCardDef(cardId);
			if (!filter(def)) continue;
			field += 1;
			if (this.canConvertAttackThisTurn(cardId, pos)) ready += 1;
		}
		for (const cardId of [...player.hand] as string[]) {
			if (!cardId) continue;
			if (filter(findCardDef(cardId))) hand += 1;
		}
		return { field, ready, hand };
	}

	private countFriendlyCitizens() {
		const player = this.state.game.p2 as any;
		let field = 0;
		let hand = 0;
		for (const cardId of [...player.field] as string[]) {
			if (!cardId) continue;
			if (this.cardMatches(findCardDef(cardId), "cidadao")) field += 1;
		}
		for (const cardId of [...player.hand] as string[]) {
			if (!cardId) continue;
			if (this.cardMatches(findCardDef(cardId), "cidadao")) hand += 1;
		}
		return { field, hand };
	}

	private countOpenFieldSlots(): number {
		const player = this.state.game.p2 as any;
		let total = 0;
		for (const cardId of [...player.field] as string[]) {
			if (!String(cardId || "")) total += 1;
		}
		return total;
	}

	private countAttackReadyCitizens(): { total: number; pressure: number } {
		const player = this.state.game.p2 as any;
		let total = 0;
		let pressure = 0;
		for (let pos = 0; pos < player.field.length; pos += 1) {
			const cardId = String(player.field[pos] || "");
			if (!cardId || !this.cardMatches(findCardDef(cardId), "cidadao")) continue;
			if (!this.canConvertAttackThisTurn(cardId, pos)) continue;
			total += 1;
			pressure += this.getUnitAttack(cardId);
		}
		return { total, pressure };
	}

	private scoreCitizenSummonFromHand(cardId: string): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		let score = this.scoreBotCard(cardId, def);
		if (name.includes("gladiador aposentado")) score += 80;
		if (name.includes("o protetor")) score += 18;
		if (name.includes("miliciano")) score += 14;
		if (name.includes("aprendiz de magia")) score -= 8;
		return score;
	}

	private scoreDiscardFromHand(cardId: string): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		const effect = this.normalizeText(def?.effect || "");
		const cost = Number(def?.cost || 0);
		let score = 0;

		if (name.includes("bartolomeu") || name.includes("gladiador aposentado")) score -= 90;
		if (effect === "chamar_cidadao") score -= 24;
		if (cost >= 6) score += 18;
		if (this.cardMatches(def, "cidadao") && cost <= 2) score += 10;
		if (name.includes("aprendiz de magia")) score += 20;
		if (name.includes("cidadaos unidos")) score += 18;
		if (name.includes("miliciano")) score += 8;
		if (this.cardMatches(def, "cidadao") && this.countFriendlyCitizens().hand >= 3) score += 8;
		return score;
	}

	private scoreTutoredCard(cardId: string, sourceDef: ReturnType<typeof findCardDef>): number {
		const def = findCardDef(cardId);
		const sourceName = this.normalizeText(sourceDef?.name || "");
		const player = this.state.game.p2 as any;
		const enemy = this.state.game.p1 as any;
		let score = this.scoreBotCard(cardId, def);

		if (sourceName.includes("arnold")) {
			const hasDefender = [...player.field].some((fieldCardId: string) => {
				const fieldDef = findCardDef(String(fieldCardId || ""));
				return !!fieldCardId && (this.cardHasKeyword(fieldDef, "bloquear") || this.cardHasKeyword(fieldDef, "provocar"));
			});
			const attackReady = [...player.field].some((fieldCardId: string, pos: number) => !!fieldCardId && this.canConvertAttackThisTurn(String(fieldCardId || ""), pos));
			const atkBonus = Number((def as any)?.atkBonus || 0);
			const defensiveBonus = Number((def as any)?.acBonus || 0) + Number((def as any)?.hpBonus || 0);
			if (defensiveBonus > atkBonus && hasDefender) score += 24;
			if (atkBonus > defensiveBonus && attackReady) score += 18;
			if (atkBonus > defensiveBonus && !attackReady) score -= 10;
		}
		if (this.isMarcialLeader() && this.isMarcialCard(def) && this.cardMatches(sourceDef, "marcial")) {
			score += 18;
			if (this.normalizeText(def?.name || "").includes("sede de vinganca")) score += 18;
			if (this.normalizeText(def?.name || "").includes("campos ensanguentados")) {
				const marcialReady = this.countFriendlyCombatProfile((entry) => this.isMarcialCard(entry)).ready;
				score += marcialReady >= 2 ? 18 : -8;
			}
		}
		if (this.isAdemaisArchetype() && sourceName.includes("observadora")) {
			const name = this.normalizeText(def?.name || cardId);
			const spiders = this.countBlackSpidersProfile();
			if (name.includes("executor")) score += 80;
			if (name.includes("emboscada")) score += this.getEnemyThreatStats().untappedThreat >= 6 ? 55 : 10;
			if (name.includes("informante")) score += enemy.hand.length >= 4 && Number(player.hp || 0) > 10 ? 36 : -10;
			if (name.includes("mascote")) score += this.countOpenFieldSlots() >= 2 ? 42 : 8;
			if (name.includes("agiota")) score += this.countLowCostPlayable(2) >= 2 ? 24 : 6;
			if (name.includes("observadora")) score -= 8;
			if (spiders.field === 0 && name.includes("executor")) score += 10;
		}
		return score;
	}

	private scoreAdemaisPlan(cardId: string, def: ReturnType<typeof findCardDef>): number {
		if (!this.isAdemaisArchetype()) return 0;
		const player = this.state.game.p2 as any;
		const enemy = this.state.game.p1 as any;
		const name = this.normalizeText(def?.name || cardId);
		const effect = this.normalizeText(def?.effect || "");
		const kind = this.normalizeText(def?.kind || def?.tipo);
		const spiders = this.countBlackSpidersProfile();
		const openSlots = this.countOpenFieldSlots();
		let score = 0;

		if (this.isBlackSpidersCard(def, cardId)) {
			score += 26;
			if (spiders.field === 0) score += 10;
		}
		if (name.includes("executor")) {
			score += 72;
			if (spiders.ready >= 2) score += 26;
			if (enemy.field.some((cid: string) => !!cid) || enemy.support.some((cid: string) => !!cid) || !!enemy.env) score += 18;
		}
		if (effect === "aranhas_mascote") {
			score += openSlots >= 2 ? 54 : 18;
		}
		if (effect === "aranhas_observadora") score += 34;
		if (effect === "aranhas_informante") score += Number(player.hp || 0) > 10 ? 10 + Math.min(18, enemy.hand.length * 5) : -28;
		if (effect === "agiota") score += this.countLowCostPlayable(2) >= 2 ? 20 : 6;
		if (effect === "aranhas_emboscada") score += this.getEnemyThreatStats().untappedThreat >= 6 ? 24 : 6;
		if (effect === "blood_sacrifice") score += Number(player.hp || 0) > 8 ? 18 : -18;
		if (effect === "espionagem_sorrateira") {
			score += this.cardMatches(findCardDef(enemy.leaderId || ""), "sombras") ? -18 : 24;
			if (enemy.hand.length >= 4) score += 12;
		}
		if (effect === "sombra_penalty") {
			score += this.cardMatches(findCardDef(enemy.leaderId || ""), "sombras") ? -24 : 28;
			if (Number(enemy.fragments || 0) >= 8) score -= 20;
		}
		if (effect === "xama_kobold") {
			const hasKoboldGrave = [...player.grave].some((graveId: string) => this.normalizeText(findCardDef(graveId)?.name || graveId).includes("kobold"));
			score += hasKoboldGrave ? 22 : -6;
		}
		if (effect === "on_grave_damage_leader") {
			score += Number(enemy.hp || 0) <= 8 ? 18 : 8;
		}
		if (this.cardMatches(def, "sombras") && !this.isBlackSpidersCard(def, cardId)) score += 4;
		if (kind === "truque") score += this.getEnemyThreatStats().untappedThreat >= 6 ? 10 : 0;

		return score;
	}

	private scoreEspionagemDiscard(cardId: string): number {
		const def = findCardDef(cardId);
		const kind = this.normalizeText(def?.kind || def?.tipo);
		const effect = this.normalizeText(def?.effect || "");
		const cost = Number(def?.cost || 0);
		let score = cost * 5;
		if (kind === "truque") score += 24;
		if (kind === "magia" || kind === "spell") score += 22;
		if (kind === "env") score += 18;
		if (effect === "anular_magia_truque") score += 28;
		if (effect === "destroy_enemy_ally" || effect === "destroy_env" || effect === "destroy_equip") score += 26;
		if (this.cardMatches(def, "marcial") || this.cardMatches(def, "arcana") || this.cardMatches(def, "religioso")) score += 8;
		return score;
	}

	private scoreExecutorBanTarget(option: ChoiceOptionLike): number {
		const id = String(option.id || "");
		const cardId = String(option.cardId || option.label || "");
		const def = findCardDef(cardId);
		const side = String(option.side || "");
		let score = side === "p1" ? 40 : -30;
		if (id.startsWith("env-p1")) score += 18;
		if (id.startsWith("support-p1")) score += 16;
		if (id.startsWith("field-p1")) score += this.getUnitAttack(cardId) * 7;
		if (this.cardHasKeyword(def, "provocar")) score += 28;
		if (this.cardHasKeyword(def, "bloquear")) score += 22;
		if (this.cardMatches(def, "sombras") && id.startsWith("env-p1")) score -= 8;
		if (this.isBlackSpidersCard(def, cardId) && side === "p2") score -= 50;
		return score;
	}

	private scoreDestroyEquipTarget(option: ChoiceOptionLike): number {
		const side = String(option.side || "");
		const cardId = String(option.cardId || option.label || "");
		const def = findCardDef(cardId);
		const pos = Number(option.pos ?? -1);
		if (side !== "p1") return -5000 - Number(def?.cost || 0) * 10;

		const enemy = this.state.game.p1 as any;
		const attachedTo = pos >= 0 ? Number(enemy.supportAttachTo?.[pos] ?? -2) : -2;
		let score = 120 + Number(def?.cost || 0) * 10;
		if (attachedTo === -1) score += 18;
		if (attachedTo >= 0) {
			const carrierCardId = String(enemy.field?.[attachedTo] || "");
			const carrierDef = findCardDef(carrierCardId);
			score += this.getUnitAttack(carrierCardId) * 8;
			if (this.cardHasKeyword(carrierDef, "provocar")) score += 26;
			if (this.cardHasKeyword(carrierDef, "bloquear")) score += 18;
		}
		return score;
	}

	private scoreKoboldGraveTarget(cardId: string): number {
		const def = findCardDef(cardId);
		let score = this.scoreBotCard(cardId, def);
		if (this.normalizeText(def?.name || cardId).includes("batedor kobold")) score += 12;
		return score;
	}

	private scoreNeutralPlan(cardId: string, def: ReturnType<typeof findCardDef>): number {
		const player = this.state.game.p2 as any;
		const enemy = this.state.game.p1 as any;
		const name = this.normalizeText(def?.name || cardId);
		const effect = this.normalizeText(def?.effect || "");
		if (!this.cardMatches(def, "neutra")) return 0;
		let score = 0;

		if (effect === "destroy_env") score += enemy.env ? 28 : -8;
		if (effect === "destroy_equip" || effect === "destroy_equip_on_enter") score += enemy.support.some((cid: string) => !!cid) ? 26 : -6;
		if (effect === "discard_enemy_hand") score += enemy.hand.length >= 3 ? 24 : 10;
		if (effect === "olhar_topo") score += 10;
		if (effect === "agiota") score += this.countLowCostPlayable(2) >= 1 ? 12 : 0;
		if (name.includes("cao de caca feroz")) score += 20;
		if (name.includes("goblin sabotador")) score += enemy.support.some((cid: string) => !!cid) ? 24 : 6;
		if (name.includes("toupeira")) score += 10;
		if (name.includes("thorn")) score += 26;
		if (name.includes("urso negro")) score += 14;
		if (name.includes("manto de couro")) score += 10;
		if (name.includes("fruto abencoado")) score += 6;
		if (name.includes("invasao de cativeiro")) score += 12;
		if (name.includes("gamboa") || name.includes("cacadora da selva")) score += enemy.hand.length >= 2 ? 24 : 8;

		if (name.includes("thorn") && Number(player.fragments || 0) < Number(def?.cost || 0)) score -= 8;
		return score;
	}

	private scoreNeutralDiscardEnemyHand(cardId: string): number {
		const def = findCardDef(cardId);
		const kind = this.normalizeText(def?.kind || def?.tipo);
		const effect = this.normalizeText(def?.effect || "");
		const cost = Number(def?.cost || 0);
		let score = cost * 4;
		if (kind === "truque") score += 24;
		if (kind === "magia" || kind === "spell") score += 18;
		if (kind === "env") score += 16;
		if (effect === "destroy_env" || effect === "destroy_equip" || effect === "anular_magia_truque") score += 24;
		return score;
	}

	private scoreNeutralEquipTarget(cardId: string, pos: number, prefersDefense: boolean): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		let score = prefersDefense ? this.getUnitResistance(cardId) * 8 + this.getUnitMaxHp(cardId) : this.scoreOffensiveBuffTarget(cardId, pos);
		if (prefersDefense && (this.cardHasKeyword(def, "bloquear") || this.cardHasKeyword(def, "provocar"))) score += 24;
		if (prefersDefense && name.includes("porco-espinho")) score += 20;
		if (!prefersDefense && name.includes("thorn")) score += 20;
		return score;
	}

	private chooseNeutralModalOption(sourceDef: ReturnType<typeof findCardDef>, options: ChoiceOptionLike[]): string | null {
		const sourceName = this.normalizeText(sourceDef?.name || "");
		const byId = (id: string) => options.find((option) => String(option.id || "") === id)?.id || null;
		const labelOf = (id: string) => this.normalizeText(options.find((option) => String(option.id || "") === id)?.label || "");

		if (sourceName.includes("fruto abencoado")) {
			const needsLeafaeHeal = this.isLeafaeArchetype() && (this.state.game.p2 as any).field.some((cid: string, pos: number) => !!cid && this.scoreLeafaeHealTarget(String(cid || ""), pos, 1) >= 20);
			if (needsLeafaeHeal && labelOf("choice-a").includes("cure")) return byId("choice-a");
			return labelOf("choice-b").includes("fragmento") ? byId("choice-b") : byId("choice-a");
		}
		if (sourceName.includes("invasao de cativeiro")) {
			const enemy = this.state.game.p1 as any;
			const hasBlocker = enemy.field.some((cid: string, pos: number) => {
				const def = findCardDef(String(cid || ""));
				return !!cid && (this.cardHasKeyword(def, "bloquear") || this.cardHasKeyword(def, "provocar")) && !enemy.fieldTapped?.[pos];
			});
			if (hasBlocker && labelOf("choice-a").includes("exaurir")) return byId("choice-a");
			if (labelOf("choice-b").includes("atk")) return byId("choice-b");
			return byId("choice-a") || byId("choice-b");
		}
		return null;
	}

	private scoreLeafaePlan(cardId: string, def: ReturnType<typeof findCardDef>): number {
		if (!this.isLeafaeArchetype()) return 0;
		const player = this.state.game.p2 as any;
		const name = this.normalizeText(def?.name || cardId);
		const effect = this.normalizeText(def?.effect || "");
		const isAnimal = this.cardMatches(def, "animal");
		const animals = this.countAnimalProfile();
		let score = 0;

		if (isAnimal) {
			score += 18;
			if (Number(def?.cost || 0) <= 4) score += 8;
		}
		if (effect === "curar_animal") score += 34;
		if (effect === "ally_heal_buff") score += 54;
		if (effect === "search_deck_animal_aura_atk") score += animals.field >= 2 ? 42 : 24;
		if (effect === "amizade_floresta") score += Number(player.hp || 0) <= 14 ? 28 : 6;
		if (effect === "damage_ally_on_enter") score += animals.field >= 2 ? 16 : 4;
		if (effect === "olhar_topo") score += animals.field <= 1 ? 10 : 2;

		if (name.includes("porco-espinho")) score += 60;
		if (name.includes("cervo")) score += 34;
		if (name.includes("jabuti")) score += this.getEnemyThreatStats().untappedThreat > 0 ? 26 : 10;
		if (name.includes("tamandua")) score += this.getEnemyThreatStats().untappedThreat > 0 ? 24 : 10;
		if (name.includes("cao de caca feroz")) score += 18;
		if (name.includes("leao rei sagrado")) score += 34;
		if (name.includes("hiena carniceira")) score += 18;
		if (name.includes("pica-pau")) score += animals.hand > 0 ? 14 : 8;
		if (name.includes("urso negro")) score += Number(player.fragments || 0) >= 5 ? 10 : 2;

		return score;
	}

	private scoreLeafaeHealTarget(cardId: string, pos: number, healAmount: number): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		const currentHp = this.getUnitCurrentHp(pos);
		const maxHp = this.getUnitMaxHp(cardId);
		const missingHp = Math.max(0, maxHp - currentHp);
		let score = Math.min(healAmount, missingHp) * 8;

		if (name.includes("porco-espinho")) score += 40;
		if (this.cardHasKeyword(def, "bloquear")) score += 26;
		if (this.cardHasKeyword(def, "provocar")) score += 24;
		if (this.canConvertAttackThisTurn(cardId, pos) && this.getUnitAttack(cardId) >= 3) score += 10;
		if (missingHp <= 0) score -= 100;
		return score;
	}

	private scoreLeafaeAnimalTutor(cardId: string): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		const animals = this.countAnimalProfile();
		let score = this.scoreBotCard(cardId, def);

		if (name.includes("porco-espinho")) score += animals.field === 0 ? 80 : 42;
		if (name.includes("cervo")) score += animals.field >= 1 ? 34 : 18;
		if (name.includes("cao de caca feroz")) score += 22;
		if (name.includes("jabuti") || name.includes("tamandua")) score += this.getEnemyThreatStats().untappedThreat > 0 ? 24 : 8;
		if (name.includes("urso negro")) score += Number((this.state.game.p2 as any).fragments || 0) >= 6 ? 16 : 4;
		return score;
	}

	private scoreTrocaEnergiaTarget(cardId: string, pos: number): number {
		const name = this.normalizeText(findCardDef(cardId)?.name || cardId);
		const currentHp = this.getUnitCurrentHp(pos);
		let score = currentHp > 2 ? 24 : 4;
		if (name.includes("porco-espinho")) score -= 20;
		if (this.cardHasKeyword(findCardDef(cardId), "bloquear") || this.cardHasKeyword(findCardDef(cardId), "provocar")) score -= 12;
		if (currentHp <= 2) score += 14;
		return score;
	}

	private scoreMarcialPlan(cardId: string, def: ReturnType<typeof findCardDef>): number {
		const player = this.state.game.p2 as any;
		const enemy = this.state.game.p1 as any;
		const cost = Number(def?.cost || 0);
		const name = this.normalizeText(def?.name || cardId);
		const effect = this.normalizeText(def?.effect || "");
		const isWarrior = this.isWarriorCard(def);
		const isMarcial = this.isMarcialCard(def);
		const marcialUnits = this.countFriendlyCombatProfile((entry) => this.isMarcialCard(entry));
		const warriorUnits = this.countFriendlyCombatProfile((entry) => this.isWarriorCard(entry));
		let score = 0;

		if (isWarrior) {
			score += 18;
			if (cost <= 4) score += 10;
		}
		if (isMarcial) score += 14;
		if (this.isKatsuArchetype() && isWarrior) {
			score += 22;
			if (cost <= 4) score += 10;
		}
		if (this.isMarcialLeader() && isMarcial) score += 14;

		if (name.includes("gladiador impenetravel")) score += untappedPressure(enemy) > 0 ? 32 : 18;
		if (name.includes("aerin")) score += 18;
		if (name.includes("gladiador veloz")) score += 30;
		if (name.includes("gladiador implacavel")) score += 28;
		if (name.includes("gladiador ousado")) score += 20;
		if (name.includes("thorn")) score += Number(player.fragments || 0) >= 7 ? 26 : 8;
		if (name.includes("yohan")) score += marcialUnits.field >= 2 ? 26 : -12;
		if (effect === "kornex_buff_per_marcial_in_play") score += marcialUnits.field >= 2 ? 16 : -8;
		if (effect === "buff_on_kill") score += 20;

		if (name.includes("campos ensanguentados")) {
			score += marcialUnits.ready >= 2 ? 34 : -10;
			if (this.cardMatches(findCardDef(enemy.leaderId || ""), "marcial")) score -= 12;
		}
		if (name.includes("lamina serralhada")) score += warriorUnits.ready >= 1 ? 22 : -10;
		if (name.includes("sede de vinganca")) score += warriorUnits.ready >= 1 ? 24 : -16;
		if (effect === "search_deck" && name.includes("arnold")) score += 12;

		return score;

		function untappedPressure(enemyPlayer: any): number {
			let total = 0;
			for (let pos = 0; pos < enemyPlayer.field.length; pos += 1) {
				const enemyCardId = String(enemyPlayer.field[pos] || "");
				if (!enemyCardId || enemyPlayer.fieldTapped?.[pos]) continue;
				total += Math.max(0, Number(findCardDef(enemyCardId)?.damage ?? findCardDef(enemyCardId)?.atkBonus ?? 0));
			}
			return total;
		}
	}

	private scoreValbrakCitizenPlan(cardId: string, def: ReturnType<typeof findCardDef>): number {
		if (!this.isValbrakCitizenArchetype()) return 0;
		const player = this.state.game.p2 as any;
		const cost = Number(def?.cost || 0);
		const effect = this.normalizeText(def?.effect || "");
		const name = this.normalizeText(def?.name || cardId);
		const kind = this.normalizeText(def?.kind || def?.tipo);
		const isCitizen = this.cardMatches(def, "cidadao");
		const { field: citizensInField, hand: citizensInHand } = this.countFriendlyCitizens();
		const openSlots = this.countOpenFieldSlots();
		let score = 0;

		if (isCitizen) {
			score += 40;
			if (cost <= 2) score += 18;
			if (citizensInField < 2) score += 14;
		}

		if (effect === "ajuda_do_povo") {
			score += openSlots >= 2 ? 56 : -12;
			if (citizensInField >= 1) score += 12;
			if (openSlots <= 1) score -= 26;
		}
		if (effect === "charlatao_da_vila") score += 34;
		if (effect === "informante_beco") score += 14;
		if (effect === "aura_hp") score += citizensInField >= 2 ? 42 : 14;
		if (effect === "chamar_cidadao") score += citizensInHand > 0 ? 36 : 6;
		if (effect === "search_deck") score += name.includes("arnold") ? 14 : 0;

		if (name.includes("o protetor")) score += citizensInField >= 2 ? 30 : 10;
		if (name.includes("miliciano")) score += 22;
		if (name.includes("aprendiz de magia")) score += 10;
		if (name.includes("gladiador aposentado") && citizensInField === 0 && Number(player.fragments || 0) < 7) score -= 4;
		if (name.includes("gladiador aposentado") && Number(player.fragments || 0) >= 7) score += 18;
		if (kind === "equip") score -= 8;
		if (kind === "env") score += 6;

		return score;
	}

	private scoreBotCard(cardId: string, def: ReturnType<typeof findCardDef>): number {
		const player = this.state.game.p2 as any;
		const enemy = this.state.game.p1 as any;
		const cost = Number(def?.cost || 0);
		const kind = this.normalizeText(def?.kind || def?.tipo);
		const effect = this.normalizeText(def?.effect || "");
		const attack = this.getUnitAttack(cardId);
		const hp = Math.max(0, Number(def?.hp ?? def?.maxHp ?? 0));
		const { untappedThreat, dangerousUnits, blockers } = this.getEnemyThreatStats();
		let score = cost * 4 + attack * 5 + hp * 2;

		if (this.cardHasKeyword(def, "provocar")) score += untappedThreat > 0 ? 42 : 26;
		if (this.cardHasKeyword(def, "bloquear")) score += untappedThreat > 0 ? 28 : 14;
		if (this.cardHasKeyword(def, "investida")) score += enemy.hp <= attack + 8 ? 24 : 16;
		if (this.cardHasKeyword(def, "atropelar")) score += blockers > 0 ? 14 : 9;

		if (effect === "destroy_enemy_ally" || effect === "dano_2_inimigo" || effect === "destroy_equip") score += dangerousUnits > 0 ? 34 : 12;
		if (effect === "destroy_env") score += enemy.env ? 20 : 0;
		if (effect === "ajuda_do_povo" || effect === "aranhas_mascote") score += 20;
		if (effect === "search_deck" || effect === "charlatao_da_vila" || effect === "informante_beco" || effect === "aranhas_observadora") score += 16;

		if (this.normalizeText(player.leaderId).includes("valbrak") && this.cardMatches(def, "cidadao")) score += 34;
		if (this.normalizeText(player.leaderId).includes("leafae") && this.cardMatches(def, "animal")) score += 18;
		score += this.scoreValbrakCitizenPlan(cardId, def);
		score += this.scoreMarcialPlan(cardId, def);
		score += this.scoreAdemaisPlan(cardId, def);
		score += this.scoreLeafaePlan(cardId, def);
		score += this.scoreNeutralPlan(cardId, def);
		if (kind === "equip") {
			const hasGoodCarrier = [...player.field].some((fieldCardId: string) => !!fieldCardId);
			score += hasGoodCarrier ? 14 : -18;
		}
		if (kind === "env") score += player.env ? -24 : 8;
		if (kind === "truque") score -= 40;

		if (this.shouldReserveFragments(cost) && kind !== "truque" && kind !== "env") score -= 18;

		return score;
	}

	private shouldHoldAttacker(cardId: string): boolean {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		const { untappedThreat, dangerousUnits } = this.getEnemyThreatStats();
		const player = this.state.game.p2 as any;
		if (untappedThreat <= 0) return false;
		if (name.includes("gladiador ousado")) return false;
		if (name.includes("gladiador implacavel")) return dangerousUnits > 1 && Number(player.hp || 0) > 10;
		if (this.cardHasKeyword(def, "bloquear") && dangerousUnits > 0) return true;
		if (this.cardHasKeyword(def, "provocar") && Number(player.hp || 0) <= untappedThreat + 8) return true;
		return false;
	}

	private shouldUseBotLeaderPower(): boolean {
		const player = this.state.game.p2 as any;
		const enemy = this.state.game.p1 as any;
		const leaderDef = findCardDef(String(player.leaderId || ""));
		if (!leaderDef || player.leaderTapped) return false;
		if (this.cardHasEffect(leaderDef, "valbrak_citizen_boost")) {
			const citizenPositions: number[] = [];
			for (let pos = 0; pos < player.field.length; pos += 1) {
				const cardId = String(player.field[pos] || "");
				if (!cardId || !this.cardMatches(findCardDef(cardId), "cidadao")) continue;
				citizenPositions.push(pos);
			}
			const readyCitizens = this.countAttackReadyCitizens();
			if (Number(player.fragments || 0) < 2) return false;
			if (this.hasStrongReactiveTrick() && Number(player.fragments || 0) <= 4) return false;
			if (this.countFriendlyCitizens().hand > 0 && this.countOpenFieldSlots() > 0 && Number(player.fragments || 0) <= 3) return false;
			if (Number(enemy.hp || 0) <= readyCitizens.pressure + readyCitizens.total) return true;
			const tappedKills = citizenPositions.filter((pos) => {
				if (!this.canConvertAttackThisTurn(String(player.field[pos] || ""), pos)) return false;
				const attack = this.getUnitAttack(String(player.field[pos] || "")) + 1;
				for (let enemyPos = 0; enemyPos < enemy.field.length; enemyPos += 1) {
					const enemyCardId = String(enemy.field[enemyPos] || "");
					if (!enemyCardId || !enemy.fieldTapped?.[enemyPos]) continue;
					const enemyHp = Number(enemy.fieldHp?.[enemyPos] || 0);
					const enemyResistance = this.getUnitResistance(enemyCardId);
					if (attack >= enemyHp + enemyResistance) return true;
				}
				return false;
			}).length;
			if (readyCitizens.total < 2 && tappedKills < 1) return false;
			if (tappedKills >= 1) return true;
			return readyCitizens.total >= 3 && Number(enemy.hp || 0) <= readyCitizens.pressure + readyCitizens.total + 4;
		}
		if (this.cardHasEffect(leaderDef, "ademais_spider_burst")) {
			const marks = Number(player.leaderSpiderMarks || 0);
			const spiders = this.countBlackSpidersProfile();
			if (marks < 4) return false;
			if (Number(enemy.hp || 0) <= 12) return true;
			if (Number(player.hp || 0) <= 10 && this.getEnemyThreatStats().dangerousUnits > spiders.field) return false;
			if (marks >= 8 && Number(enemy.hp || 0) <= 18) return true;
			if (spiders.field >= 2 && this.getEnemyThreatStats().blockers >= 2 && Number(enemy.hp || 0) <= 21) return true;
			return Number(player.hp || 0) >= Number(enemy.hp || 0) && Number(enemy.hp || 0) <= 15;
		}
		if (this.cardHasEffect(leaderDef, "leafae_vital_guard")) {
			if (Number(player.leaderVitalMarks || 0) < 3) return false;
			const defensivePressure = this.getEnemyThreatStats().untappedThreat > 0;
			for (let pos = 0; pos < player.field.length; pos += 1) {
				const cardId = String(player.field[pos] || "");
				if (!cardId) continue;
				if (this.scoreLeafaeHealTarget(cardId, pos, 2) >= (defensivePressure ? 30 : 44)) return true;
			}
		}
		return false;
	}

	private scoreAttackTarget(attackerPos: number, target: AttackTarget): number {
		const enemy = this.state.game.p1 as any;
		const attackerId = String(this.state.game.p2.field[attackerPos] || "");
		const attackerDef = findCardDef(attackerId);
		const attackerName = this.normalizeText(attackerDef?.name || attackerId);
		const attack = this.getUnitAttack(attackerId);
		if (target.type === "leader") {
			const lethal = Number(enemy.hp || 0) <= Math.max(1, attack);
			let score = lethal ? 1000 : 20 + Math.max(0, 30 - Number(enemy.hp || 0));
			if (attackerName.includes("thorn") && Number(enemy.hp || 0) <= attack + 6) score += 50;
			if (this.isKatsuArchetype() && Number(enemy.hp || 0) <= attack + 4) score += 20;
			return score;
		}
		const targetCardId = String(enemy.field[target.targetPos] || "");
		if (!targetCardId) return -999;
		const targetDef = findCardDef(targetCardId);
		const hp = Number(enemy.fieldHp?.[target.targetPos] || 0);
		const resistance = this.getUnitResistance(targetCardId);
		const targetAttack = this.getUnitAttack(targetCardId);
		const canKill = attack >= hp + resistance;
		let score = canKill ? 80 : 18;
		score += targetAttack * 6;
		score += hp <= 2 ? 20 : 0;
		if (this.cardHasKeyword(targetDef, "provocar")) score += 26;
		if (this.cardHasKeyword(targetDef, "bloquear")) score += 16;
		if (enemy.fieldTapped?.[target.targetPos]) score += 14;
		if (this.isKatsuArchetype() && this.isWarriorCard(attackerDef)) {
			if (canKill) score += 34;
			if (!enemy.fieldTapped?.[target.targetPos]) score += 18;
			if (Number(enemy.hp || 0) <= 10 && canKill) score += 24;
		}
		if (attackerName.includes("thorn") && canKill) score += Math.max(0, attack - (hp + resistance)) * 12;
		if (attackerName.includes("gladiador implacavel") && canKill) score += 30;
		return score;
	}

	private canConvertAttackThisTurn(cardId: string, pos: number): boolean {
		if (!cardId) return false;
		const player = this.state.game.p2 as any;
		const def = findCardDef(cardId);
		if (player.fieldTapped?.[pos]) return false;
		if (this.summonedThisTurn.p2.has(pos) && !this.cardHasKeyword(def, "investida")) return false;
		return true;
	}

	private getForcedChallengeTargets(): number[] {
		const enemy = this.state.game.p1 as any;
		const forced: number[] = [];
		for (let pos = 0; pos < enemy.field.length; pos += 1) {
			const cardId = String(enemy.field[pos] || "");
			if (!cardId) continue;
			if (!enemy.fieldTapped?.[pos]) continue;
			if (!this.cardHasKeyword(findCardDef(cardId), "provocar")) continue;
			forced.push(pos);
		}
		return forced;
	}

	private scoreOffensiveBuffTarget(cardId: string, pos: number): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		let score = this.getUnitAttack(cardId) * 8 + this.getUnitResistance(cardId) * 2;
		if (this.canConvertAttackThisTurn(cardId, pos)) score += 34;
		if (this.cardHasKeyword(def, "investida")) score += 16;
		if (this.cardHasKeyword(def, "atropelar")) score += 14;
		if (this.cardHasKeyword(def, "bloquear")) score -= 12;
		if (this.cardHasKeyword(def, "provocar")) score -= 10;
		if (name.includes("thorn")) score += 20;
		if (name.includes("gladiador veloz")) score += 16;
		if (name.includes("gladiador implacavel")) score += 14;
		if (name.includes("gladiador ousado")) score -= 8;
		return score;
	}

	private scoreWarriorChoice(cardId: string, pos: number): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		let score = this.scoreOffensiveBuffTarget(cardId, pos);
		if (name.includes("gladiador implacavel")) score += 18;
		if (name.includes("gladiador veloz")) score += 14;
		if (name.includes("thorn")) score += 24;
		if (name.includes("gladiador ousado")) score -= 10;
		return score;
	}

	private scoreMarcialExhaustChoice(cardId: string, pos: number): number {
		const def = findCardDef(cardId);
		const name = this.normalizeText(def?.name || cardId);
		let score = 0;
		if (!this.canConvertAttackThisTurn(cardId, pos)) score += 40;
		if (name.includes("arnold")) score += 22;
		if (name.includes("aerin")) score += 10;
		if (name.includes("gladiador implacavel")) score -= 32;
		if (name.includes("gladiador veloz")) score -= 24;
		if (name.includes("yohan")) score -= 18;
		if (name.includes("thorn")) score -= 26;
		return score;
	}

	private scoreEnemyDisplaceTarget(cardId: string, pos: number): number {
		const enemy = this.state.game.p1 as any;
		const def = findCardDef(cardId);
		let score = this.getUnitAttack(cardId) * 7;
		if (!enemy.fieldTapped?.[pos]) score += 18;
		if (this.cardHasKeyword(def, "provocar")) score += 26;
		if (this.cardHasKeyword(def, "bloquear")) score += 18;
		return score;
	}

	private scoreEnemyTapTarget(option: ChoiceOptionLike): number {
		const id = String(option.id || "");
		if (id === "tap-leader") {
			const enemyThreat = this.getEnemyThreatStats();
			return enemyThreat.dangerousUnits > 0 ? 10 : -20;
		}
		const cardId = String(option.cardId || option.label || "");
		const pos = Number(option.pos ?? -1);
		return this.scoreEnemyDisplaceTarget(cardId, pos) + 12;
	}

	private scoreEnemyAttackReductionTarget(option: ChoiceOptionLike): number {
		const cardId = String(option.cardId || option.label || "");
		const pos = Number(option.pos ?? -1);
		const enemy = this.state.game.p1 as any;
		const def = findCardDef(cardId);
		let score = this.getUnitAttack(cardId) * 9;
		if (!enemy.fieldTapped?.[pos]) score += 18;
		if (this.cardHasKeyword(def, "provocar")) score += 16;
		if (this.cardHasKeyword(def, "bloquear")) score += 12;
		return score;
	}

	private scoreOwnTapTarget(option: ChoiceOptionLike): number {
		const cardId = String(option.cardId || option.label || "");
		const pos = Number(option.pos ?? -1);
		const player = this.state.game.p2 as any;
		const def = findCardDef(cardId);
		let score = 0;
		if (pos >= 0 && player.fieldTapped?.[pos]) score += 40;
		if (pos >= 0 && !this.canConvertAttackThisTurn(cardId, pos)) score += 36;
		if (this.cardHasKeyword(def, "bloquear")) score -= 28;
		if (this.cardHasKeyword(def, "provocar")) score -= 34;
		score -= this.getUnitAttack(cardId) * 4;
		return score;
	}

	private scoreDirectDamageTarget(option: ChoiceOptionLike, damage: number): number {
		const side = String(option.side || "");
		const cardId = String(option.cardId || option.label || "");
		const def = findCardDef(cardId);
		const id = String(option.id || "");
		if (side === "p2") {
			if (id.includes("leader")) return -5000;
			return -2000 - this.getUnitAttack(cardId) * 10;
		}
		if (id.includes("leader")) {
			const enemyHp = Number(this.state.game.p1.hp || 0);
			let score = enemyHp <= damage ? 5000 : damage * 10;
			if (enemyHp <= 8) score += 40;
			return score;
		}
		const enemy = this.state.game.p1 as any;
		const pos = Number(option.pos ?? -1);
		const hp = pos >= 0 ? Math.max(0, Number(enemy.fieldHp?.[pos] || 0)) : Number(def?.hp || 0);
		let score = this.getUnitAttack(cardId) * 8;
		if (hp > 0 && hp <= damage) score += 120;
		if (hp > damage) score += Math.max(0, 20 - hp * 2);
		if (this.cardHasKeyword(def, "provocar")) score += 28;
		if (this.cardHasKeyword(def, "bloquear")) score += 22;
		if (!enemy.fieldTapped?.[pos]) score += 14;
		return score;
	}

	private scoreSelfDamageCostTarget(option: ChoiceOptionLike, damage: number): number {
		const id = String(option.id || "");
		if (id.includes("leader")) return -2000;
		const cardId = String(option.cardId || option.label || "");
		const pos = Number(option.pos ?? -1);
		const hp = pos >= 0 ? this.getUnitCurrentHp(pos) : this.getUnitMaxHp(cardId);
		let score = hp > damage ? hp * 3 : -1500;
		if (this.normalizeText(cardId).includes("aranhas mascote")) score += 14;
		if (this.normalizeText(cardId).includes("kobold")) score += 8;
		return score - this.getUnitAttack(cardId) * 2;
	}

	private pickBestOption(options: ChoiceOptionLike[], scorer: (option: ChoiceOptionLike) => number): string | null {
		let bestId: string | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const option of options) {
			const id = String(option?.id || "");
			if (!id) continue;
			const score = scorer(option);
			if (score > bestScore) {
				bestScore = score;
				bestId = id;
			}
		}
		return bestId;
	}

	private resetInactivityTimer(sessionId: string | null) {
		this.clearInactivityTimer();
		if (!sessionId || this.state.phase === "FINISHED") return;
		this.inactivityTimeout = setTimeout(() => {
			this.inactivityTimeout = null;
			if (this.state.phase === "FINISHED") return;
			const player = this.state.players.get(sessionId);
			const loser = player?.slot === "p1" || player?.slot === "p2" ? (player.slot as Slot) : null;
			if (!loser) return;
			this.activeChoiceSessionId = null;
			finishMatch(this.state, loser, "inactivity", (name, payload) => this.broadcastMatchEvent(name, payload));
		}, INACTIVITY_TIMEOUT_MS);
	}

	private refreshInactivityTimer() {
		if (this.state.phase === "FINISHED") {
			this.clearInactivityTimer();
			return;
		}
		if (this.state.game.phase === "MULLIGAN") {
			if (!this.state.game.p1MulliganDone) {
				this.resetInactivityTimer(this.sessionIdBySlot("p1"));
				return;
			}
			this.resetInactivityTimer(null);
			return;
		}
		if (this.activeChoiceSessionId) {
			this.resetInactivityTimer(this.activeChoiceSessionId);
			return;
		}
		const sessionId = this.state.game.turnSlot === "p1" ? this.sessionIdBySlot("p1") : null;
		this.resetInactivityTimer(sessionId);
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
		resolveOpeningMulligans(
			this.state,
			this.pendingMulligans.p1 || [],
			this.pendingMulligans.p2 || [],
			(name, payload) => this.broadcastMatchEvent(name, payload),
			this.attackedThisTurn,
			this.summonedThisTurn,
			this.triggeredLeaderThisTurn,
			this.askChoice
		);
		this.pendingMulligans = { p1: null, p2: null };
		if (this.state.game.phase === "INITIAL") {
			nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
		}
		this.refreshInactivityTimer();
		this.queueBotTurn();
	}

	private chooseBotOption(payload: ChoicePayload): string | null {
		const options = (Array.isArray(payload?.options) ? payload.options : []).filter((option) => !option?.disabled) as ChoiceOptionLike[];
		if (!options.length) return null;
		const title = this.normalizeText(payload?.title || "");
		const sourceDef = findCardDef(this.inferChoiceSourceCardId(payload) || "");
		if (title.includes("substituir")) return options[0]?.id || null;
		if (title.includes("escolha um efeito")) {
			const neutralChoice = this.chooseNeutralModalOption(sourceDef, options);
			if (neutralChoice) return neutralChoice;
		}
		if (title.includes("agiota")) {
			const useAgiota = options.find((option) => String(option.id || "").startsWith("agiota-"));
			return useAgiota?.id || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "xama_kobold") && title.includes("deseja ativar o efeito")) {
			const koboldInGrave = (this.state.game.p2 as any).grave.some((graveId: string) => this.normalizeText(findCardDef(graveId)?.name || graveId).includes("kobold"));
			return koboldInGrave ? (options.find((option) => String(option.id || "") === "xama-yes")?.id || options[0]?.id || null) : (options.find((option) => String(option.id || "") === "xama-no")?.id || options[0]?.id || null);
		}
		if (this.cardHasEffect(sourceDef, "xama_kobold") && title.includes("kobold do seu cemiterio")) {
			const bestKobold = this.pickBestOption(options, (option) => this.scoreKoboldGraveTarget(String(option.cardId || option.label || "")));
			return bestKobold || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "espionagem_sorrateira") && title.includes("escolha carta para descartar")) {
			const bestDiscard = this.pickBestOption(options, (option) => this.scoreEspionagemDiscard(String(option.cardId || option.label || "")));
			return bestDiscard || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "discard_enemy_hand") && title.includes("mao do oponente para descartar")) {
			const bestDiscardEnemy = this.pickBestOption(options, (option) => this.scoreNeutralDiscardEnemyHand(String(option.cardId || option.label || "")));
			return bestDiscardEnemy || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "ban_on_enter") && title.includes("escolha carta para deslocar")) {
			const bestBan = this.pickBestOption(options, (option) => this.scoreExecutorBanTarget(option));
			return bestBan || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "curar_animal") && title.includes("escolha animal para curar")) {
			const bestAnimalHeal = this.pickBestOption(options, (option) => this.scoreLeafaeHealTarget(String(option.cardId || option.label || ""), Number(option.pos ?? -1), Number((sourceDef as any)?.effectValue || 1)));
			return bestAnimalHeal || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "amizade_floresta") && title.includes("escolha um animal aliado")) {
			const bestTradeAnimal = this.pickBestOption(options, (option) => this.scoreTrocaEnergiaTarget(String(option.cardId || option.label || ""), Number(option.pos ?? -1)));
			return bestTradeAnimal || options[0]?.id || null;
		}
		if (this.cardHasEffect(sourceDef, "search_deck_animal_aura_atk") && title.includes("aliado animal do deck")) {
			const bestAnimal = this.pickBestOption(options, (option) => this.scoreLeafaeAnimalTutor(String(option.cardId || option.label || "")));
			return bestAnimal || options[0]?.id || null;
		}
		if (title.includes("escolha um aliado para curar 2 de vida") && this.cardHasEffect(findCardDef(this.state.game.p2?.leaderId || ""), "leafae_vital_guard")) {
			const bestLeafaeHeal = this.pickBestOption(options, (option) => this.scoreLeafaeHealTarget(String(option.cardId || option.label || ""), Number(option.pos ?? -1), 2));
			return bestLeafaeHeal || options[0]?.id || null;
		}
		if (title.includes("interpor")) {
			const leaderUnderHeavyHit = String(payload?.targetName || "").includes(String(this.state.game.p2.leaderId || "")) && Number(payload?.attackerAttack || 0) >= 4;
			const bestBlock = this.pickBestOption(options, (option) => {
				if (String(option.id || "") === "block-cancel") return leaderUnderHeavyHit ? -500 : 10;
				const cardId = String(option.cardId || option.label || "");
				const blockDef = findCardDef(cardId);
				let score = 0;
				if (this.cardHasKeyword(blockDef, "bloquear")) score += 18;
				if (this.cardHasKeyword(blockDef, "provocar")) score += 12;
				score += Math.max(0, this.getUnitResistance(cardId) + Number(blockDef?.hp ?? 0) - Number(payload?.attackerAttack || 0));
				return score;
			});
			return bestBlock || options[0]?.id || null;
		}
		if (title.includes("escolha equipamento para destruir")) {
			const bestEquipDestroy = this.pickBestOption(options, (option) => this.scoreDestroyEquipTarget(option));
			return bestEquipDestroy || options[0]?.id || null;
		}
		if (title.includes("equipar")) {
			const prefersDefense = Number((sourceDef as any)?.acBonus || (sourceDef as any)?.hpBonus || 0) > Number((sourceDef as any)?.atkBonus || 0);
			const bestEquipTarget = this.pickBestOption(options, (option) => {
				const id = String(option.id || "");
				if (id === "equip-leader") return prefersDefense ? 40 : -1000;
				const cardId = String(option.cardId || option.label || "");
				const def = findCardDef(cardId);
				let score = this.normalizeText(sourceDef?.name || "").includes("manto de couro")
					? this.scoreNeutralEquipTarget(cardId, Number(option.pos ?? -1), prefersDefense)
					: (prefersDefense ? this.getUnitAttack(cardId) * 2 : this.scoreOffensiveBuffTarget(cardId, Number(option.pos ?? -1)));
				if (prefersDefense && this.cardHasKeyword(def, "provocar")) score += 26;
				if (prefersDefense && this.cardHasKeyword(def, "bloquear")) score += 20;
				if (!prefersDefense && this.cardHasKeyword(def, "investida")) score += 18;
				return score;
			});
			return bestEquipTarget || options[0]?.id || null;
		}
		if (title.includes("escolha um guerreiro aliado")) {
			const bestWarrior = this.pickBestOption(options, (option) => {
				if (typeof option.pos !== "number") return -1000;
				return this.scoreWarriorChoice(String(option.cardId || option.label || ""), option.pos);
			});
			return bestWarrior || options[0]?.id || null;
		}
		if (title.includes("escolha um aliado marcial para exaurir")) {
			const bestOwn = this.pickBestOption(options, (option) => {
				if (typeof option.pos !== "number") return -1000;
				return this.scoreMarcialExhaustChoice(String(option.cardId || option.label || ""), option.pos);
			});
			return bestOwn || options[0]?.id || null;
		}
		if (title.includes("escolha aliado inimigo para exaurir") || title.includes("desloque 1 aliado inimigo")) {
			const bestEnemyTempo = this.pickBestOption(options, (option) => this.scoreEnemyDisplaceTarget(String(option.cardId || option.label || ""), Number(option.pos ?? -1)));
			return bestEnemyTempo || options[0]?.id || null;
		}
		if (title.includes("escolha um cidadao da mao para invocar")) {
			const bestCitizen = this.pickBestOption(options, (option) => this.scoreCitizenSummonFromHand(String(option.cardId || option.label || "")));
			return bestCitizen || options[0]?.id || null;
		}
		if (title.includes("escolha 1 carta da sua mao para descartar")) {
			const discardPick = this.pickBestOption(options, (option) => this.scoreDiscardFromHand(String(option.cardId || option.label || "")));
			return discardPick || options[0]?.id || null;
		}
		if (title.includes("escolha uma carta do deck") || title.includes("buscar ")) {
			const deckPick = this.pickBestOption(options, (option) => this.scoreTutoredCard(String(option.cardId || option.label || ""), sourceDef));
			return deckPick || options[0]?.id || null;
		}
		if (title.includes("escolha alvo para 2 de dano")) {
			const bestDamageTarget = this.pickBestOption(options, (option) => this.scoreDirectDamageTarget(option, 2));
			return bestDamageTarget || options[0]?.id || null;
		}
		if (title.includes("escolha personagem inimigo para 4 de dano")) {
			const bestBigDamageTarget = this.pickBestOption(options, (option) => this.scoreDirectDamageTarget(option, 4));
			return bestBigDamageTarget || options[0]?.id || null;
		}
		if (title.includes("escolha personagem seu para receber 2 de dano")) {
			const bestSelfDamageTarget = this.pickBestOption(options, (option) => this.scoreSelfDamageCostTarget(option, 2));
			return bestSelfDamageTarget || options[0]?.id || null;
		}
		if (title.includes("escolha um inimigo para deitar")) {
			const bestTapTarget = this.pickBestOption(options, (option) => this.scoreEnemyTapTarget(option));
			return bestTapTarget || options[0]?.id || null;
		}
		if (title.includes("escolha inimigo para reduzir atk")) {
			const bestAtkReduction = this.pickBestOption(options, (option) => this.scoreEnemyAttackReductionTarget(option));
			return bestAtkReduction || options[0]?.id || null;
		}
		if (title.includes("escolha aliado para deitar")) {
			const bestOwnTap = this.pickBestOption(options, (option) => this.scoreOwnTapTarget(option));
			return bestOwnTap || options[0]?.id || null;
		}
		if (title.includes("receber +") && title.includes(" atk")) {
			const bestAtkBuff = this.pickBestOption(options, (option) => {
				if (String(option.side || "") !== "p2") return -1000;
				if (typeof option.pos !== "number") return -1000;
				const cardId = String(option.cardId || option.label || "");
				return this.scoreOffensiveBuffTarget(cardId, option.pos);
			});
			return bestAtkBuff || options[0]?.id || null;
		}
		if (title.includes("aliado inimigo")) {
			const bestEnemy = this.pickBestOption(options, (option) => {
				const cardId = String(option.cardId || option.label || "");
				const def = findCardDef(cardId);
				let score = this.getUnitAttack(cardId) * 7 + Math.max(0, 8 - Number((def?.hp || 0))) * 2;
				if (this.cardHasKeyword(def, "provocar")) score += 24;
				if (this.cardHasKeyword(def, "bloquear")) score += 18;
				return score;
			});
			return bestEnemy || options[0]?.id || null;
		}
		if (title.includes("curar") || title.includes("heal")) {
			const healPick = this.pickBestOption(options, (option) => {
				if (String(option.id || "") === "heal-leader") return Number(this.state.game.p2.hp || 0) <= 12 ? 60 : 18;
				const cardId = String(option.cardId || option.label || "");
				const def = findCardDef(cardId);
				let score = this.getUnitAttack(cardId) * 6;
				if (this.cardHasKeyword(def, "provocar")) score += 18;
				if (this.cardHasKeyword(def, "bloquear")) score += 18;
				return score;
			});
			return healPick || options[0]?.id || null;
		}
		const leader = options.find((option) => option.id === "heal-leader");
		return leader?.id || options[0]?.id || null;
	}

	private askChoice = (slot: Slot, payload: ChoicePayload, onResolve: (optionId: string | null) => void) => {
		if (slot === "p2") {
			const pick = this.chooseBotOption(payload);
			this.activeChoiceSessionId = "__bot__";
			setTimeout(() => {
				if (this.activeChoiceSessionId === "__bot__") this.activeChoiceSessionId = null;
				onResolve(pick);
				this.refreshInactivityTimer();
				this.queueBotTurn();
			}, 250);
			return;
		}

		const sessionId = this.sessionIdBySlot(slot);
		if (!sessionId) {
			this.activeChoiceSessionId = null;
			this.refreshInactivityTimer();
			onResolve(null);
			return;
		}

		const timeoutMs = 40_000;
		const choiceId = `choice-${++this.choiceSeq}`;
		const optionIds = (Array.isArray(payload.options) ? payload.options : [])
			.filter((option: any) => !option?.disabled)
			.map((option) => String(option?.id || ""))
			.filter(Boolean);

		const timeout = setTimeout(() => {
			const pending = this.pendingChoices.get(choiceId);
			if (!pending) return;
			this.pendingChoices.delete(choiceId);
			this.activeChoiceSessionId = null;
			const fallback = pending.multiSelect ? null : (pending.optionIds[0] || null);
			pending.resolve(fallback);
			this.refreshInactivityTimer();
			this.queueBotTurn();
		}, timeoutMs);

		this.pendingChoices.set(choiceId, { sessionId, resolve: onResolve, timeout, optionIds, multiSelect: payload.multiSelect === true });
		const client = this.clients.find((entry) => entry.sessionId === sessionId);
		if (!client) {
			clearTimeout(timeout);
			this.pendingChoices.delete(choiceId);
			this.activeChoiceSessionId = null;
			this.refreshInactivityTimer();
			onResolve(null);
			return;
		}

		this.activeChoiceSessionId = sessionId;
		this.resetInactivityTimer(sessionId);
		client.send("effect_choice_required", {
			choiceId,
			title: payload.title,
			options: payload.options,
			sourceCardId: this.inferChoiceSourceCardId(payload),
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

	private queueBotTurn() {
		this.clearBotTimer();
		if (this.state.phase === "FINISHED") return;
		if (this.activeChoiceSessionId) return;
		if (this.pendingChoices.size > 0) return;
		if (this.state.game.turnSlot === "p1") {
			if (this.state.game.phase !== "INITIAL") return;
			this.botTurnTimer = setTimeout(() => {
				this.botTurnTimer = null;
				if (this.state.phase === "FINISHED") return;
				if (this.activeChoiceSessionId) return;
				if (this.pendingChoices.size > 0) return;
				if (this.state.game.turnSlot !== "p1" || this.state.game.phase !== "INITIAL") return;
				nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
				this.refreshInactivityTimer();
				this.queueBotTurn();
			}, 350);
			return;
		}
		if (this.state.game.turnSlot !== "p2") return;
		this.botTurnTimer = setTimeout(() => {
			this.botTurnTimer = null;
			this.runBotTurn();
		}, 450);
	}

	private canBotPlayCardNow(cardId: string, def: ReturnType<typeof findCardDef>): boolean {
		const enemy = this.state.game.p1 as any;
		const effect = this.normalizeText(def?.effect || "");
		if (effect === "destroy_env") return !!String(enemy.env || "");
		if (effect === "destroy_enemy_ally") return enemy.field.some((cid: string) => !!cid);
		if (effect === "destroy_equip") {
			for (const supportId of enemy.support as string[]) {
				if (!supportId) continue;
				const supportDef = findCardDef(String(supportId || ""));
				const kind = this.normalizeText(supportDef?.kind || supportDef?.tipo);
				if (kind === "equip" || kind === "equipamento") return true;
			}
			return false;
		}
		return true;
	}

	private pickPlayableBotCards() {
		const player = this.state.game.p2 as any;
		return [...player.hand]
			.map((cardId: string) => {
				const def = findCardDef(cardId);
				const cost = Number(def?.cost || 0);
				return { cardId, def, cost, score: this.scoreBotCard(cardId, def) } satisfies BotPlayCandidate;
			})
			.filter(({ def }) => {
				const cost = Number(def?.cost || 0);
				const kind = String(def?.kind || def?.tipo || "").toLowerCase();
				const effect = String(def?.effect || "");
				if (effect === "bem_treinado" || effect === "freeser") return false;
				if (kind === "trick" || kind === "truque") return false;
				if (!this.canBotPlayCardNow("", def)) return false;
				return Number(player.fragments || 0) >= cost;
			})
			.sort((left, right) => {
				if (right.score !== left.score) return right.score - left.score;
				const leftCost = Number(left.cost || 0);
				const rightCost = Number(right.cost || 0);
				if (rightCost !== leftCost) return rightCost - leftCost;
				return String(left.cardId).localeCompare(String(right.cardId));
			});
	}

	private pickBotAttackTarget(attackerPos: number): AttackTarget {
		const enemy = this.state.game.p1 as any;
		const forcedChallengeTargets = this.getForcedChallengeTargets();
		const targets: AttackTarget[] = forcedChallengeTargets.length ? [] : [{ type: "leader" }];
		for (let pos = 0; pos < enemy.field.length; pos += 1) {
			const cardId = String(enemy.field[pos] || "");
			if (!cardId) continue;
			if (forcedChallengeTargets.length && !forcedChallengeTargets.includes(pos)) continue;
			targets.push({ type: "ally", targetPos: pos });
		}
		targets.sort((left, right) => this.scoreAttackTarget(attackerPos, right) - this.scoreAttackTarget(attackerPos, left));
		return targets[0] || { type: "leader" };
	}

	private performBotPrep() {
		let actions = 0;
		const leaderSeq = Number(this.state.game.seq || 0);
		if (this.shouldUseBotLeaderPower()) {
			activateLeaderPower(this.state, "p2", (name, payload) => this.broadcastMatchEvent(name, payload), this.askChoice);
		}
		if (this.state.phase === "FINISHED" || this.pendingChoices.size > 0 || this.activeChoiceSessionId) return;
		if (Number(this.state.game.seq || 0) !== leaderSeq) actions += 1;

		while (actions < 4 && this.state.game.phase === "PREP" && this.pendingChoices.size === 0 && !this.activeChoiceSessionId) {
			const beforeLeaderSeq = Number(this.state.game.seq || 0);
			if (this.shouldUseBotLeaderPower()) {
				activateLeaderPower(this.state, "p2", (name, payload) => this.broadcastMatchEvent(name, payload), this.askChoice);
			}
			if (this.state.phase === "FINISHED" || this.pendingChoices.size > 0 || this.activeChoiceSessionId) return;
			if (Number(this.state.game.seq || 0) !== beforeLeaderSeq) {
				actions += 1;
				continue;
			}

			const nextCard = this.pickPlayableBotCards()[0];
			if (!nextCard) break;
			const beforeSeq = Number(this.state.game.seq || 0);
			playCard(
				this.state,
				"p2",
				nextCard.cardId,
				undefined,
				String(nextCard.def?.kind || nextCard.def?.tipo || ""),
				(name, payload) => this.broadcastMatchEvent(name, payload),
				this.summonedThisTurn,
				this.triggeredLeaderThisTurn,
				this.askChoice
			);
			if (this.state.phase === "FINISHED" || this.pendingChoices.size > 0 || this.activeChoiceSessionId) return;
			if (Number(this.state.game.seq || 0) === beforeSeq) break;
			actions += 1;
		}
	}

	private performBotCombat() {
		for (let pos = 0; pos < this.state.game.p2.field.length; pos += 1) {
			if (!canAttackServer(this.state, "p2", pos, this.attackedThisTurn, this.summonedThisTurn)) continue;
			const attackerId = String(this.state.game.p2.field[pos] || "");
			if (!attackerId) continue;
			if (this.shouldHoldAttacker(attackerId)) continue;
			const beforeSeq = Number(this.state.game.seq || 0);
			const preferredTarget = this.pickBotAttackTarget(pos);
			attack(
				this.state,
				"p2",
				pos,
				preferredTarget,
				(name, payload) => this.broadcastMatchEvent(name, payload),
				this.attackedThisTurn,
				this.summonedThisTurn,
				this.triggeredLeaderThisTurn,
				this.askChoice
			);
			if (this.state.phase === "FINISHED" || this.pendingChoices.size > 0 || this.activeChoiceSessionId) return;
			if (Number(this.state.game.seq || 0) === beforeSeq) {
				attack(
					this.state,
					"p2",
					pos,
					{ type: "leader" },
					(name, payload) => this.broadcastMatchEvent(name, payload),
					this.attackedThisTurn,
					this.summonedThisTurn,
					this.triggeredLeaderThisTurn,
					this.askChoice
				);
			}
			if (this.state.phase === "FINISHED" || this.pendingChoices.size > 0 || this.activeChoiceSessionId) return;
		}
	}

	private runBotTurn() {
		if (this.state.phase === "FINISHED") return;
		if (this.state.game.turnSlot !== "p2") return;
		if (this.pendingChoices.size > 0 || this.activeChoiceSessionId) return;

		if (this.state.game.phase === "INITIAL") {
			nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
			this.refreshInactivityTimer();
			this.queueBotTurn();
			return;
		}

		if (this.state.game.phase === "PREP") {
			this.performBotPrep();
			if (this.state.game.phase === "PREP" && this.pendingChoices.size === 0 && !this.activeChoiceSessionId) {
				nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
			}
			this.refreshInactivityTimer();
			this.queueBotTurn();
			return;
		}

		if (this.state.game.phase === "COMBAT") {
			this.performBotCombat();
			if (this.state.game.phase === "COMBAT" && this.pendingChoices.size === 0 && !this.activeChoiceSessionId) {
				nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
			}
			this.refreshInactivityTimer();
			this.queueBotTurn();
			return;
		}

		if (this.state.game.phase === "END") {
			endTurn(this.state, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.refreshInactivityTimer();
			this.queueBotTurn();
		}
	}

	onAuth(_client: Client, options: any) {
		const joinToken = String(options?.joinToken || "").trim();
		if (!this.reservedSeat || joinToken !== this.reservedSeat.joinToken) throw new Error("invalid_match_join_token");
		if (this.consumedJoinToken) throw new Error("match_join_token_already_used");
		return this.reservedSeat;
	}

	onCreate(options: any) {
		this.setState(new MatchState());
		this.reservedSeat = options?.seatReservation ? {
			joinToken: String(options.seatReservation.joinToken || ""),
			lobbySessionId: String(options.seatReservation.lobbySessionId || ""),
			slot: options.seatReservation.slot === "p2" ? "p2" : "p1",
			displayName: this.sanitizeDisplayName(options.seatReservation.displayName)
		} : null;
		this.bot = {
			displayName: this.sanitizeDisplayName(options?.bot?.displayName || "IA"),
			leaderId: String(options?.bot?.leaderId || options?.p2?.leaderId || "Valbrak, O Mago Popular"),
			deckId: String(options?.bot?.deckId || "solo-bot-default"),
			cards: Array.isArray(options?.bot?.cards) ? options.bot.cards.map((card: unknown) => String(card)).filter(Boolean) : [],
			accessories: options?.bot?.accessories ? {
				sleeve: String(options.bot.accessories.sleeve || "").trim() || undefined,
				playmat: String(options.bot.accessories.playmat || "").trim() || undefined
			} : undefined
		};

		this.setMetadata({
			title: `${String(this.reservedSeat?.displayName || "Jogador")} vs ${this.bot.displayName}`,
			p1Name: String(this.reservedSeat?.displayName || "Jogador"),
			p2Name: this.bot.displayName,
			p1LeaderId: String(options?.p1?.leaderId || ""),
			p2LeaderId: this.bot.leaderId,
			mode: "solo"
		});

		const starterSlot: Slot = options?.starterSlot === "p2" ? "p2" : "p1";
		initGame(
			this.state,
			options?.p1,
			{
				deckId: this.bot.deckId,
				leaderId: this.bot.leaderId,
				cards: this.bot.cards || [],
				accessories: this.bot.accessories || {}
			},
			(name, payload) => this.broadcastMatchEvent(name, payload),
			this.attackedThisTurn,
			this.summonedThisTurn,
			this.triggeredLeaderThisTurn,
			starterSlot,
			this.askChoice
		);
		this.pendingMulligans = { p1: null, p2: this.chooseBotOpeningMulligan() };
		this.state.game.p2MulliganDone = true;
		this.startMulliganTimer();
		this.refreshInactivityTimer();

		this.onMessage("submit_mulligan", (client, msg: { indices?: number[] }) => {
			if (this.state.phase !== "IN_MATCH" || this.state.game.phase !== "MULLIGAN") return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (slot !== "p1" || this.state.game.p1MulliganDone) return;
			for (const pending of this.pendingChoices.values()) {
				if (pending.sessionId === client.sessionId) return;
			}
			const selection = this.parseMulliganSelection(msg?.indices, this.state.game.p1.hand.length);
			if (!selection) {
				client.send("error", { message: "invalid_mulligan_selection" });
				return;
			}
			this.pendingMulligans.p1 = selection;
			this.state.game.p1MulliganDone = true;
			this.tryResolveOpeningMulligan();
		});

		this.onMessage("next_phase", (client) => {
			if (!this.isValidTurnAction(client, ["INITIAL", "PREP", "COMBAT"])) return;
			nextPhase(this.state, (name, payload) => this.broadcastMatchEvent(name, payload));
			this.refreshInactivityTimer();
			this.queueBotTurn();
		});

		this.onMessage("end_turn", (client) => {
			if (!this.isValidTurnAction(client, ["END"])) return;
			endTurn(this.state, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.refreshInactivityTimer();
			this.queueBotTurn();
		});

		this.onMessage("play_card", (client, msg: { cardId?: string; targetPos?: number; cardKind?: string }) => {
			if (!this.isValidTurnAction(client, ["PREP"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			const cardId = String(msg?.cardId || "");
			const targetPos = Number(msg?.targetPos);
			const cardKind = String(msg?.cardKind || "");
			if (!slot || !cardId) return;
			playCard(this.state, slot, cardId, Number.isInteger(targetPos) ? targetPos : undefined, cardKind, (name, payload) => this.broadcastMatchEvent(name, payload), this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.refreshInactivityTimer();
			this.queueBotTurn();
		});

		this.onMessage("leader_power", (client) => {
			if (!this.isValidTurnAction(client, ["PREP"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot) return;
			activateLeaderPower(this.state, slot, (name, payload) => this.broadcastMatchEvent(name, payload), this.askChoice);
			this.refreshInactivityTimer();
			this.queueBotTurn();
		});

		this.onMessage("effect_choice_submit", (client, msg: { choiceId?: string; optionId?: string | null }) => {
			const choiceId = String(msg?.choiceId || "");
			if (!choiceId) return;
			const pending = this.pendingChoices.get(choiceId);
			if (!pending || pending.sessionId !== client.sessionId) return;
			this.pendingChoices.delete(choiceId);
			if (pending.timeout) clearTimeout(pending.timeout);
			this.activeChoiceSessionId = null;
			pending.resolve(msg?.optionId == null ? null : String(msg.optionId));
			this.refreshInactivityTimer();
			this.queueBotTurn();
		});

		this.onMessage("attack", (client, msg: { attackerPos?: number; attackerLeader?: boolean; target?: string; targetPos?: number }) => {
			if (!this.isValidTurnAction(client, ["COMBAT"])) return;
			const slot = getSlotBySession(this.state, client.sessionId);
			if (!slot) return;
			if (msg?.attackerLeader === true) return;
			const attackerPos = Number(msg?.attackerPos);
			if (!Number.isInteger(attackerPos) || attackerPos < 0) return;
			const rawTarget = String(msg?.target || "leader");
			const target: AttackTarget = rawTarget === "ally" ? { type: "ally", targetPos: Number(msg?.targetPos) } : { type: "leader" };
			attack(this.state, slot, attackerPos, target, (name, payload) => this.broadcastMatchEvent(name, payload), this.attackedThisTurn, this.summonedThisTurn, this.triggeredLeaderThisTurn, this.askChoice);
			this.refreshInactivityTimer();
			this.queueBotTurn();
		});

		this.onMessage("set_name", (client, msg: { name?: string }) => {
			const player = this.state.players.get(client.sessionId);
			if (!player) return;
			player.displayName = this.sanitizeDisplayName(msg?.name);
		});

		this.refreshInactivityTimer();
		this.queueBotTurn();
	}

	onJoin(client: Client, _options?: any, auth?: ReservedSeat) {
		if (!auth) throw new Error("missing_reserved_seat");
		const player = new MatchPlayerState();
		player.sessionId = client.sessionId;
		player.slot = auth.slot;
		player.displayName = auth.displayName;
		this.state.players.set(client.sessionId, player);
		this.consumedJoinToken = true;
		if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
		client.send("assign_slot", { slot: player.slot, sessionId: client.sessionId });
		this.refreshInactivityTimer();
		this.queueBotTurn();
	}

	async onLeave(client: Client, consented?: boolean) {
		const leavingPlayer = this.state.players.get(client.sessionId);
		const leavingSlot = leavingPlayer?.slot === "p1" || leavingPlayer?.slot === "p2" ? (leavingPlayer.slot as Slot) : null;
		if (!consented && leavingSlot && this.state.phase !== "FINISHED") {
			try {
				console.log(`[SOLO] waiting reconnect room=${this.roomId} client=${client.sessionId} slot=${leavingSlot}`);
				await this.allowReconnection(client, RECONNECTION_GRACE_SECONDS);
				console.log(`[SOLO] reconnected room=${this.roomId} client=${client.sessionId} slot=${leavingSlot}`);
				this.refreshInactivityTimer();
				this.queueBotTurn();
				return;
			} catch (error) {
				console.log(`[SOLO] reconnect expired room=${this.roomId} client=${client.sessionId} slot=${leavingSlot}`);
			}
		}
		for (const [choiceId, pending] of this.pendingChoices.entries()) {
			if (pending.sessionId !== client.sessionId) continue;
			this.pendingChoices.delete(choiceId);
			if (pending.timeout) clearTimeout(pending.timeout);
			pending.resolve(null);
		}
		if (this.activeChoiceSessionId === client.sessionId) this.activeChoiceSessionId = null;
		if (leavingSlot && this.state.phase !== "FINISHED") {
			finishMatch(this.state, leavingSlot, "opponent_left", (name, payload) => this.broadcastMatchEvent(name, payload));
		}
		this.state.players.delete(client.sessionId);
		this.clearBotTimer();
		this.clearMulliganTimer(true);
		this.clearInactivityTimer();
	}

	onDispose() {
		this.clearBotTimer();
		this.clearMulliganTimer(true);
		this.clearInactivityTimer();
	}

	private isValidTurnAction(client: Client, phases: string[]) {
		if (this.state.phase !== "IN_MATCH") return false;
		const slot = getSlotBySession(this.state, client.sessionId);
		if (!slot || slot !== "p1") return false;
		if (this.state.game.turnSlot !== slot) return false;
		for (const pending of this.pendingChoices.values()) {
			if (pending.sessionId === client.sessionId) return false;
		}
		if (!phases.includes(this.state.game.phase)) return false;
		return true;
	}
}