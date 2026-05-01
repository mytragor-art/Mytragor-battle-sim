/* Responsibility: match gameplay state transitions only (no Colyseus room wiring). */

import { drawToHand, shuffle, buildDeckFromId } from "../../game/engine";
import { findCardDef, type CardDef } from "../../game/cardCatalog";
import { MatchState } from "../schema/MatchState";
import type { TurnPhase } from "../schema/GameState";

export type Slot = "p1" | "p2";
export type AttackTarget = { type: "leader" } | { type: "ally"; targetPos: number };
export type ChoiceOption = { id: string; label: string; description?: string; side?: Slot; lane?: "field" | "support" | "env" | "deck" | "grave"; pos?: number; cardId?: string; disabled?: boolean; disabledReason?: string };
export type ChoicePayload = {
	title: string;
	options: ChoiceOption[];
	allowCancel?: boolean;
	multiSelect?: boolean;
	submitLabel?: string;
	minSelections?: number;
	maxSelections?: number;
	sourceCardId?: string;
	attackerId?: string;
	attackerName?: string;
	attackerAttack?: number;
	targetCardId?: string;
	targetName?: string;
	targetResistance?: number;
	targetHp?: number;
	targetMaxHp?: number;
};
export type AskChoiceFn = (slot: Slot, payload: ChoicePayload, onResolve: (optionId: string | null) => void) => void;
export type MatchEndReason = "hp_zero" | "deckout" | "inactivity" | "opponent_left";

function ensureFieldSlots(field: { length: number; push: (value: string) => number }) {
	while (field.length < 5) field.push("");
}

function getCombatAttackValue(state: MatchState, slot: Slot, attackerId: string, attackerPos: number, reactiveAttackPenalty: number): number {
	const me = asPlayer(state, slot) as any;
	const enemySlotId = enemySlot(slot);
	const attackerDef = findCardDef(attackerId);
	const isLeaderAttacker = attackerPos < 0;
	let attackValue = getAttackBonus(attackerId) + reactiveAttackPenalty + getAuraAttackBonus(state, slot, attackerId);
	if (isLeaderAttacker) {
		attackValue += getLeaderAttackBonus(me);
		attackValue += getAttachedSupportNumericBonus(me, null, "atkBonus");
		attackValue += getLeaderDamageBonus(me);
	} else {
		attackValue += Number(me.fieldAtkTemp[attackerPos] || 0);
		attackValue += getFieldAttackPermBonus(me, attackerPos);
		attackValue += getAttachedSupportNumericBonus(me, attackerPos, "atkBonus");
		attackValue += getFieldDamageBonusFromVital(me, attackerPos);
	}
	if (!isLeaderAttacker && String(attackerDef?.effect || "") === "kornex_buff_per_marcial_in_play") {
		let marcialCount = 0;
		for (const currentSlot of [slot, enemySlotId] as Slot[]) {
			const player = asPlayer(state, currentSlot);
			const leaderId = String(player.leaderId || "");
			if (leaderId && cardHasFiliation(leaderId, "Marcial")) marcialCount += 1;
			for (let index = 0; index < player.field.length; index += 1) {
				const cardId = String(player.field[index] || "");
				if (cardId && cardHasFiliation(cardId, "Marcial")) marcialCount += 1;
			}
			for (let index = 0; index < player.support.length; index += 1) {
				const cardId = String(player.support[index] || "");
				if (cardId && cardHasFiliation(cardId, "Marcial")) marcialCount += 1;
			}
			const envId = String(player.env || "");
			if (envId && cardHasFiliation(envId, "Marcial")) marcialCount += 1;
		}
		attackValue += Math.max(0, marcialCount - 1);
	}
	if (hasMarcialEnvAttackBonus(state, slot, attackerId)) attackValue += 1;
	attackValue += getAttachedSupportCounter(me, "draw_bonus", isLeaderAttacker ? null : attackerPos);
	attackValue += getAttachedSupportNumericBonus(me, isLeaderAttacker ? null : attackerPos, "dmgBonus");
	return attackValue;
}

function normalizeKind(kind: string | undefined): string {
	return String(kind || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();
}

function normalizeLoose(value: string | undefined): string {
	return normalizeKind(value).replace(/[^a-z0-9]+/g, "");
}

function isAllyKind(kind: string | undefined): boolean {
	const normalized = normalizeKind(kind);
	return normalized === "ally" || normalized === "aliado";
}

function isEnvKind(kind: string | undefined): boolean {
	const normalized = normalizeKind(kind);
	return normalized === "env" || normalized === "ambiente";
}

function isEquipKind(kind: string | undefined): boolean {
	const normalized = normalizeKind(kind);
	return normalized === "equip" || normalized === "equipamento";
}

function isSpellOrTrickKind(kind: string | undefined): boolean {
	const normalized = normalizeKind(kind);
	return normalized === "spell" || normalized === "magia" || normalized === "truque" || normalized === "trick";
}

function getCardCost(cardId: string): number {
	const card = findCardDef(cardId);
	const cost = Number(card?.cost);
	return Number.isFinite(cost) && cost >= 0 ? cost : 1;
}

function randomD20(): number {
	return 1 + Math.floor(Math.random() * 20);
}

function cardHasKeyword(card: CardDef | undefined, keyword: string): boolean {
	if (!card) return false;
	const expected = normalizeKind(keyword);
	const arr = Array.isArray(card.keywords) ? card.keywords : [];
	for (const kw of arr) {
		if (normalizeKind(String(kw || "")) === expected) return true;
	}
	const text = normalizeKind(String(card.text || ""));
	if (!text) return false;
	if (expected === "precisao" || expected === "precisao") return text.includes("precisao") || text.includes("precis");
	return text.includes(expected);
}

function getAttackBonus(cardId: string): number {
	const card = findCardDef(cardId);
	const value = Number(card?.atkBonus);
	return Number.isFinite(value) ? value : 0;
}

function getDamageValue(cardId: string): number {
	const card = findCardDef(cardId);
	const value = Number(card?.damage);
	if (Number.isFinite(value) && value > 0) return value;
	return 1;
}

function getCardMaxHp(cardId: string): number {
	const card = findCardDef(cardId);
	const value = Number(card?.hp);
	if (Number.isFinite(value) && value > 0) return value;
	return 1;
}

function getDamageReduction(cardId: string): number {
	const card = findCardDef(cardId) as any;
	const value = Number(card?.damageTakenReduction || 0);
	if (Number.isFinite(value) && value > 0) return value;
	return 0;
}

function getCardEffectIds(card: CardDef | undefined): string[] {
	if (!card) return [];
	const raw = [card.effect, (card as any)?.effectA, (card as any)?.effectB];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const effectId = String(value || "").trim();
		if (!effectId || seen.has(effectId)) continue;
		seen.add(effectId);
		out.push(effectId);
	}
	return out;
}

function cardHasEffectId(card: CardDef | undefined, effectId: string): boolean {
	return getCardEffectIds(card).includes(String(effectId || "").trim());
}

function leaderHasEffect(player: any, effectId: string): boolean {
	return cardHasEffectId(findCardDef(String(player?.leaderId || "")), effectId);
}

function leaderEffectTurnKey(player: any, effectId: string): string {
	const leaderId = String(player?.leaderId || "leader");
	return `${leaderId}:${String(effectId || "").trim()}`;
}

function cardEffectTurnKey(cardId: string, effectId: string): string {
	return `${String(cardId || "card").trim()}:${String(effectId || "").trim()}`;
}

function getLeaderAttackBonus(_player: any): number {
	return 0;
}

function getLeaderDamageBonus(_player: any): number {
	return 0;
}

function getLeaderIncomingDamageReduction(_player: any): number {
	return 0;
}

function applyDamageToLeader(player: any, amount: number, fromCombat = false): number {
	let reduction = getLeaderIncomingDamageReduction(player);
	const minimumApplied = fromCombat && Number(amount || 0) === 1 ? 1 : 0;
	const applied = Math.max(minimumApplied, Number(amount || 0) - reduction);
	player.hp = Math.max(0, Number(player?.hp || 0) - applied);
	return applied;
}

function getFieldVitalMarks(player: any, pos: number): number {
	const cid = String(player?.field?.[pos] || "");
	if (!cid) return 0;
	const def = findCardDef(cid) as any;
	if (String(def?.effect || "") !== "ally_heal_buff") return 0;
	const value = Number(player?.fieldVitalMarks?.[pos] || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function getFieldAttackPermBonus(player: any, pos: number): number {
	const value = Number(player?.fieldAtkPerm?.[pos] || 0);
	return (Number.isFinite(value) ? value : 0) + getFieldVitalMarks(player, pos);
}

function getFieldAcPermBonus(player: any, pos: number): number {
	const value = Number(player?.fieldAcPerm?.[pos] || 0);
	return Number.isFinite(value) ? value : 0;
}

function getFieldDamageBonusFromVital(player: any, pos: number): number {
	return 0;
}

function getFieldHpBonusFromVital(player: any, pos: number): number {
	return getFieldVitalMarks(player, pos);
}

function countNameInBattlefield(state: MatchState, expectedNamePart: string): number {
	const expected = normalizeKind(expectedNamePart).replace(/[^a-z0-9]+/g, "");
	if (!expected) return 0;
	let total = 0;
	for (const side of ["p1", "p2"] as Slot[]) {
		const p = asPlayer(state, side);
		const leaderId = String(p.leaderId || "");
		if (leaderId) {
			const leaderName = String(findCardDef(leaderId)?.name || leaderId || "");
			const normalizedLeader = normalizeKind(leaderName).replace(/[^a-z0-9]+/g, "");
			if (normalizedLeader.includes(expected)) total += 1;
		}
		for (let i = 0; i < p.field.length; i += 1) {
			const cid = String(p.field[i] || "");
			if (!cid) continue;
			const normalized = normalizeKind(String(findCardDef(cid)?.name || cid || "")).replace(/[^a-z0-9]+/g, "");
			if (normalized.includes(expected)) total += 1;
		}
		for (let i = 0; i < p.support.length; i += 1) {
			const cid = String(p.support[i] || "");
			if (!cid) continue;
			const normalized = normalizeKind(String(findCardDef(cid)?.name || cid || "")).replace(/[^a-z0-9]+/g, "");
			if (normalized.includes(expected)) total += 1;
		}
		const envId = String(p.env || "");
		if (envId) {
			const normalizedEnv = normalizeKind(String(findCardDef(envId)?.name || envId || "")).replace(/[^a-z0-9]+/g, "");
			if (normalizedEnv.includes(expected)) total += 1;
		}
	}
	return total;
}

function countControlledName(state: MatchState, slot: Slot, expectedNamePart: string): number {
	const expected = normalizeKind(expectedNamePart).replace(/[^a-z0-9]+/g, "");
	if (!expected) return 0;
	let total = 0;
	const p = asPlayer(state, slot);
	const leaderId = String(p.leaderId || "");
	if (leaderId) {
		const leaderName = String(findCardDef(leaderId)?.name || leaderId || "");
		const normalizedLeader = normalizeKind(leaderName).replace(/[^a-z0-9]+/g, "");
		if (normalizedLeader.includes(expected)) total += 1;
	}
	for (let i = 0; i < p.field.length; i += 1) {
		const cid = String(p.field[i] || "");
		if (!cid) continue;
		const cardName = String(findCardDef(cid)?.name || cid || "");
		const normalized = normalizeKind(cardName).replace(/[^a-z0-9]+/g, "");
		if (normalized.includes(expected)) total += 1;
	}
	return total;
}

function cardNameIncludes(cardId: string, expectedNamePart: string): boolean {
	const expected = normalizeKind(expectedNamePart).replace(/[^a-z0-9]+/g, "");
	if (!expected) return false;
	const name = String(findCardDef(cardId)?.name || cardId || "");
	const normalized = normalizeKind(name).replace(/[^a-z0-9]+/g, "");
	return normalized.includes(expected);
}

function countSpellsInGrave(player: any): number {
	let total = 0;
	for (let i = 0; i < player.grave.length; i += 1) {
		const cid = String(player.grave[i] || "");
		if (!cid) continue;
		const def = findCardDef(cid);
		if (!def) continue;
		if (normalizeKind(String(def.kind || def.tipo || "")) === "spell") total += 1;
	}
	return total;
}

function hasSupportEffect(player: any, effect: string): boolean {
	for (let i = 0; i < player.support.length; i += 1) {
		const cid = String(player.support[i] || "");
		if (!cid) continue;
		const def = findCardDef(cid);
		if (String(def?.effect || "") === effect) return true;
	}
	return false;
}

function supportAttachedTo(player: any, supportPos: number): number {
	const raw = Number(player?.supportAttachTo?.[supportPos]);
	if (!Number.isFinite(raw)) return -2;
	if (raw === -1) return -1;
	if (raw >= 0 && raw < 5) return raw;
	return -2;
}

function targetHasSupportEffect(player: any, effect: string, targetPos: number | null): boolean {
	const expected = targetPos == null ? -1 : targetPos;
	for (let i = 0; i < player.support.length; i += 1) {
		const cid = String(player.support[i] || "");
		if (!cid) continue;
		const def = findCardDef(cid);
		if (String(def?.effect || "") !== effect) continue;
		if (supportAttachedTo(player, i) === expected) return true;
	}
	return false;
}

function getAttachedSupportCounter(player: any, effect: string, targetPos: number | null): number {
	const expected = targetPos == null ? -1 : targetPos;
	let total = 0;
	for (let i = 0; i < player.support.length; i += 1) {
		const cid = String(player.support[i] || "");
		if (!cid) continue;
		const def = findCardDef(cid);
		if (String(def?.effect || "") !== effect) continue;
		if (supportAttachedTo(player, i) !== expected) continue;
		const value = Number(player?.supportCounters?.[i] || 0);
		if (Number.isFinite(value) && value > 0) total += value;
	}
	return total;
}

function getAttachedSupportNumericBonus(player: any, targetPos: number | null, prop: string): number {
	const expected = targetPos == null ? -1 : targetPos;
	let total = 0;
	for (let i = 0; i < player.support.length; i += 1) {
		const cid = String(player.support[i] || "");
		if (!cid) continue;
		if (supportAttachedTo(player, i) !== expected) continue;
		const def = findCardDef(cid) as any;
		const value = Number(def?.[prop] || 0);
		if (Number.isFinite(value)) total += value;
	}
	return total;
}

function getLeaderBlessing(player: any): number {
	const value = Number(player?.leaderBlessing || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function getFieldBlessing(player: any, pos: number): number {
	const value = Number(player?.fieldBlessing?.[pos] || 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function getLeaderMaxHp(player: any): number {
	const leaderId = String(player?.leaderId || "");
	const leaderDef = findCardDef(leaderId);
	const baseHp = Number(leaderDef?.hp || 20);
	return Math.max(1, (Number.isFinite(baseHp) ? baseHp : 20) + getAttachedSupportNumericBonus(player, null, "hpBonus"));
}

function getFieldMaxHp(state: MatchState, slot: Slot, targetPos: number): number {
	const player = asPlayer(state, slot);
	const cardId = String(player.field[targetPos] || "");
	if (!cardId) return 1;
	return Math.max(1, getCardDynamicMaxHp(state, slot, cardId) + getAttachedSupportNumericBonus(player, targetPos, "hpBonus") + getFieldHpBonusFromVital(player, targetPos) + getFieldBlessing(player, targetPos));
}

function removeAttachedSupportHpBonus(state: MatchState, ownerSlot: Slot, attachedTo: number, supportCardId: string): void {
	const owner = asPlayer(state, ownerSlot) as any;
	const hpBonus = Number((findCardDef(supportCardId) as any)?.hpBonus || 0);
	if (!(hpBonus > 0)) return;
	if (attachedTo === -1) {
		const nextMaxHp = getLeaderMaxHp(owner);
		owner.hp = Math.min(nextMaxHp, Math.max(1, Number(owner.hp || 0) - hpBonus));
		return;
	}
	if (!Number.isInteger(attachedTo) || attachedTo < 0 || attachedTo >= owner.field.length) return;
	if (!String(owner.field[attachedTo] || "")) return;
	const nextMaxHp = getFieldMaxHp(state, ownerSlot, attachedTo);
	owner.fieldHp[attachedTo] = Math.min(nextMaxHp, Math.max(1, Number(owner.fieldHp[attachedTo] || 0) - hpBonus));
}

function clearSupportAt(player: any, supportPos: number): string {
	const cid = String(player.support[supportPos] || "");
	player.support[supportPos] = "";
	if (player.supportAttachTo) player.supportAttachTo[supportPos] = -2;
	if (player.supportCounters) player.supportCounters[supportPos] = 0;
	return cid;
}

function setDeckCards(player: any, cards: string[]): void {
	player.deck.clear();
	for (const cardId of cards) player.deck.push(cardId);
}

function removeDeckCardAt(player: any, index: number): string {
	const cards = Array.from(player.deck as Iterable<string>).map((cardId) => String(cardId || ""));
	if (!Number.isInteger(index) || index < 0 || index >= cards.length) return "";
	const [removed] = cards.splice(index, 1);
	setDeckCards(player, cards);
	return String(removed || "");
}

function moveDeckCardToBottom(player: any, index: number): string {
	const cards = Array.from(player.deck as Iterable<string>).map((cardId) => String(cardId || ""));
	if (!Number.isInteger(index) || index < 0 || index >= cards.length) return "";
	const [moved] = cards.splice(index, 1);
	if (!moved) return "";
	cards.unshift(moved);
	setDeckCards(player, cards);
	return moved;
}

function cardMatchesAuraTarget(cardId: string, auraTarget: any): boolean {
	if (!auraTarget) return false;
	const def = findCardDef(cardId) as any;
	if (!def) return false;
	if (auraTarget.classe) return normalizeKind(String(def?.classe || "")) === normalizeKind(String(auraTarget.classe || ""));
	if (auraTarget.tipo) return normalizeKind(String(def?.tipo || "")) === normalizeKind(String(auraTarget.tipo || ""));
	if (auraTarget.nameIncludes) return normalizeKind(String(def?.name || cardId || "")).includes(normalizeKind(String(auraTarget.nameIncludes || "")));
	return false;
}

function getAuraAttackBonus(state: MatchState, ownerSlot: Slot, cardId: string): number {
	const owner = asPlayer(state, ownerSlot);
	let bonus = 0;
	for (let i = 0; i < owner.field.length; i += 1) {
		const sourceId = String(owner.field[i] || "");
		if (!sourceId) continue;
		const sourceDef = findCardDef(sourceId) as any;
		if (normalizeKind(String(sourceDef?.auraProp || "")) !== "atk") continue;
		if (!cardMatchesAuraTarget(cardId, sourceDef?.auraTarget)) continue;
		const value = Number(sourceDef?.effectValue || 1);
		bonus += Number.isFinite(value) ? value : 1;
	}
	return bonus;
}

function getAuraHpBonus(state: MatchState, ownerSlot: Slot, cardId: string): number {
	const owner = asPlayer(state, ownerSlot);
	let bonus = 0;
	for (let i = 0; i < owner.field.length; i += 1) {
		const sourceId = String(owner.field[i] || "");
		if (!sourceId) continue;
		const sourceDef = findCardDef(sourceId) as any;
		if (String(sourceDef?.effect || "") !== "aura_hp") continue;
		if (!cardMatchesAuraTarget(cardId, sourceDef?.auraTarget)) continue;
		const value = Number(sourceDef?.effectValue || 1);
		bonus += Number.isFinite(value) ? value : 1;
	}
	return bonus;
}

function getCardDynamicMaxHp(state: MatchState, slot: Slot, cardId: string): number {
	return Math.max(1, getCardMaxHp(cardId) + getAuraHpBonus(state, slot, cardId));
}

function broadcastRevealedTopCard(
	state: MatchState,
	broadcast: (name: string, payload: any) => void,
	payload: { viewerSlot?: Slot; ownerSlot: Slot; sourceSlot: Slot; sourceCardId: string; cardId: string; text: string }
): void {
	broadcast("revealed_top_card", {
		viewerSlot: payload.viewerSlot,
		ownerSlot: payload.ownerSlot,
		sourceSlot: payload.sourceSlot,
		sourceCardId: payload.sourceCardId,
		cardId: payload.cardId,
		text: payload.text,
		seq: Number(state.game.seq || 0)
	});
}

function placeAllyOnField(
	state: MatchState,
	ownerSlot: Slot,
	owner: any,
	cardId: string,
	pos: number,
	broadcast?: (name: string, payload: any) => void,
	askChoice?: AskChoiceFn
): void {
	owner.field[pos] = cardId;
	(owner as any).fieldHp[pos] = getCardDynamicMaxHp(state, ownerSlot, cardId);
	(owner as any).fieldTapped[pos] = false;
	(owner as any).fieldFrozen[pos] = 0;
	(owner as any).fieldPinnedUntilTurn[pos] = 0;
	(owner as any).fieldAtkTemp[pos] = 0;
	(owner as any).fieldAtkPerm[pos] = 0;
	(owner as any).fieldAcPerm[pos] = 0;
	(owner as any).fieldSedeMark[pos] = 0;
	(owner as any).fieldBloodMarks[pos] = 0;
	(owner as any).fieldVitalMarks[pos] = 0;
	applyAuraHpBonusFromSource(state, ownerSlot, cardId, pos);
	if (broadcast && askChoice) triggerFieldEntryEffects(state, ownerSlot, cardId, pos, broadcast, askChoice);
}

function awardAdemaisSpiderMarkOnSummon(
	state: MatchState,
	slot: Slot,
	cardId: string,
	broadcast: (name: string, payload: any) => void
): void {
	if (!cardNameIncludes(cardId, "Aranhas Negras")) return;
	const owner = asPlayer(state, slot) as any;
	const ownerLeaderId = String(owner.leaderId || "");
	const ownerLeaderDef = findCardDef(ownerLeaderId);
	if (!ownerLeaderId || !cardHasEffectId(ownerLeaderDef, "ademais_spider_mark")) return;
	owner.leaderSpiderMarks = Number(owner.leaderSpiderMarks || 0) + 1;
	broadcast("effect_log", {
		slot,
		cardId: ownerLeaderId,
		effect: "ademais_spider_mark",
		text: `${ownerLeaderId}: recebeu 1 marcador Aranha ao convocar ${cardId}.`
	});
}

function summonGeneratedToken(
	state: MatchState,
	slot: Slot,
	owner: any,
	cardId: string,
	pos: number,
	broadcast: (name: string, payload: any) => void,
	askChoice: AskChoiceFn
): void {
	placeAllyOnField(state, slot, owner, cardId, pos, broadcast, askChoice);
	const tokenDef = findCardDef(cardId);
	if (!cardHasKeyword(tokenDef, "investida")) {
		owner.fieldPinnedUntilTurn[pos] = Math.max(Number(owner.fieldPinnedUntilTurn[pos] || 0), Number(state.game.turn || 0));
	}
	awardAdemaisSpiderMarkOnSummon(state, slot, cardId, broadcast);
	state.game.seq += 1;
	broadcast("card_played", {
		slot,
		lane: "field",
		cardId,
		targetPos: pos,
		cost: 0,
		p1Fragments: state.game.p1.fragments,
		p2Fragments: state.game.p2.fragments,
		seq: state.game.seq
	});
}

function triggerFieldEntryEffects(
	state: MatchState,
	slot: Slot,
	cardId: string,
	pos: number,
	broadcast: (name: string, payload: any) => void,
	askChoice: AskChoiceFn
): void {
	const cardDef = findCardDef(cardId);
	let shouldTriggerAuto = true;
	if (String(cardDef?.effect || "") === "aranhas_observadora") {
		const owner = asPlayer(state, slot) as any;
		const turnToken = Number(state.game.turn || 0);
		if (Number(owner.observadoraTriggerTurn ?? -1) === turnToken) {
			shouldTriggerAuto = false;
			broadcast("effect_log", { slot, cardId, effect: "aranhas_observadora", text: `${cardId}: o efeito de Aranhas Negras, Observadora já foi ativado neste turno.` });
		} else {
			owner.observadoraTriggerTurn = turnToken;
		}
	}
	if (String(cardDef?.effect || "") === "charlatao_da_vila") {
		const owner = asPlayer(state, slot) as any;
		const turnToken = Number(state.game.turn || 0);
		const triggerKey = cardEffectTurnKey(cardId, "charlatao_da_vila");
		if (Number(owner[triggerKey] ?? -1) === turnToken) {
			shouldTriggerAuto = false;
			broadcast("effect_log", { slot, cardId, effect: "charlatao_da_vila", text: `${cardId}: o efeito já foi ativado neste turno.` });
		} else {
			owner[triggerKey] = turnToken;
		}
	}
	if (shouldTriggerAuto) triggerAutoEffects(state, slot, cardId, cardDef, broadcast, askChoice, { lane: "field", pos });
}

function applyAuraHpBonusFromSource(state: MatchState, ownerSlot: Slot, sourceCardId: string, sourcePos?: number): void {
	const owner = asPlayer(state, ownerSlot) as any;
	const sourceDef = findCardDef(sourceCardId) as any;
	if (String(sourceDef?.effect || "") !== "aura_hp") return;
	const value = Math.max(1, Number(sourceDef?.effectValue || 1));
	for (let pos = 0; pos < owner.field.length; pos += 1) {
		const cid = String(owner.field[pos] || "");
		if (!cid) continue;
		if (sourcePos === pos) continue;
		if (!cardMatchesAuraTarget(cid, sourceDef?.auraTarget)) continue;
		const current = Number(owner.fieldHp[pos] || 0);
		const maxHp = getFieldMaxHp(state, ownerSlot, pos);
		owner.fieldHp[pos] = Math.min(maxHp, Math.max(1, current + value));
	}
}

function removeAuraHpBonusFromSource(state: MatchState, ownerSlot: Slot, sourceCardId: string): void {
	const owner = asPlayer(state, ownerSlot) as any;
	const sourceDef = findCardDef(sourceCardId) as any;
	if (String(sourceDef?.effect || "") !== "aura_hp") return;
	const value = Math.max(1, Number(sourceDef?.effectValue || 1));
	for (let pos = 0; pos < owner.field.length; pos += 1) {
		const cid = String(owner.field[pos] || "");
		if (!cid) continue;
		if (!cardMatchesAuraTarget(cid, sourceDef?.auraTarget)) continue;
		const current = Number(owner.fieldHp[pos] || 0);
		const maxHp = getFieldMaxHp(state, ownerSlot, pos);
		owner.fieldHp[pos] = Math.min(maxHp, Math.max(1, current - value));
	}
}

function triggerLeafaeOnAllyHeal(state: MatchState, slot: Slot, broadcast: (name: string, payload: any) => void, sourceCardId: string): void {
	const me = asPlayer(state, slot) as any;
	const leaderId = String(me.leaderId || "");
	if (leaderId) {
		const leaderDef = findCardDef(leaderId);
		if (cardHasEffectId(leaderDef, "leafae")) {
			me.leaderVitalMarks = Number(me.leaderVitalMarks || 0) + 1;
			broadcast("effect_log", {
				slot,
				cardId: leaderId,
				effect: "leafae",
				text: `${leaderId}: ganhou 1 marcador de Elo Vital ao curar um aliado com ${sourceCardId}.`
			});
		}
	}
	for (let pos = 0; pos < me.field.length; pos += 1) {
		const cid = String(me.field[pos] || "");
		if (!cid) continue;
		const def = findCardDef(cid) as any;
		if (String(def?.effect || "") !== "ally_heal_buff") continue;
		me.fieldVitalMarks[pos] = Number(me.fieldVitalMarks[pos] || 0) + 1;
		const currentHp = Number(me.fieldHp[pos] || 0);
		const maxHp = getFieldMaxHp(state, slot, pos);
		me.fieldHp[pos] = Math.min(maxHp, currentHp + 1);
		broadcast("effect_log", {
			slot,
			cardId: cid,
			effect: "ally_heal_buff",
			text: `${cid}: ganhou 1 marcador de Elo Vital ao curar um aliado com ${sourceCardId}.`
		});
	}
}

function handleDestroyedAllyTriggers(
	state: MatchState,
	ownerSlot: Slot,
	destroyedCardId: string,
	broadcast: (name: string, payload: any) => void,
	askChoice: AskChoiceFn,
	reason?: { fromCombat?: boolean }
) {
	const owner = asPlayer(state, ownerSlot) as any;
	const def = findCardDef(destroyedCardId) as any;
	const freePosForReaction = firstEmptyFieldPos(owner);
	if (freePosForReaction >= 0) {
		const reactionOptions: ChoiceOption[] = [];
		for (let index = 0; index < owner.hand.length; index += 1) {
			const cid = String(owner.hand[index] || "");
			if (!cid) continue;
			const cardDef = findCardDef(cid);
			if (String(cardDef?.effect || "") !== "bem_treinado") continue;
			const cost = getCardCost(cid);
			if (Number(owner.fragments || 0) < cost) continue;
			reactionOptions.push({ id: `bem-react-${index}`, label: cid, side: ownerSlot, lane: "support", pos: index, cardId: cid, description: `Pagar ${cost} fragmento(s) para convocar um aliado Marcial do cemitério.` });
		}
		if (reactionOptions.length) {
			askChoice(ownerSlot, { title: `${destroyedCardId}: deseja ativar Alerta de Fuga?`, options: [...reactionOptions, { id: "bem-react-skip", label: "Não ativar" }], allowCancel: true }, (optionId) => {
				if (!optionId || optionId === "bem-react-skip") return;
				const reactionPick = reactionOptions.find((option) => option.id === optionId);
				if (!reactionPick || !reactionPick.cardId) return;
				const liveHandIndex = owner.hand.findIndex((cid: string) => String(cid || "") === reactionPick.cardId);
				if (liveHandIndex < 0) return;
				const reactionCardId = String(owner.hand[liveHandIndex] || "");
				if (!reactionCardId) return;
				const cost = getCardCost(reactionCardId);
				if (Number(owner.fragments || 0) < cost) return;
				const graveOptions: ChoiceOption[] = [];
				for (let index = 0; index < owner.grave.length; index += 1) {
					const cid = String(owner.grave[index] || "");
					if (!cid) continue;
					const cardDef = findCardDef(cid);
					if (!cardDef) continue;
					if (!isAllyKind(cardDef.kind || cardDef.tipo)) continue;
					if (!cardHasFiliation(cid, "Marcial")) continue;
					graveOptions.push({ id: `bem-grave-${index}`, label: cid, side: ownerSlot, lane: "grave", pos: index, cardId: cid });
				}
				if (!graveOptions.length) return;
				const freePos = firstEmptyFieldPos(owner);
				if (freePos < 0) return;
				owner.fragments -= cost;
				owner.hand.splice(liveHandIndex, 1);
				owner.grave.push(reactionCardId);
				maybeOfferCounterToActivation(state, ownerSlot, reactionCardId, broadcast, askChoice, () => {
					askChoice(ownerSlot, { title: `${reactionCardId}: escolha aliado Marcial do cemitério`, options: graveOptions, allowCancel: true }, (graveOptionId) => {
						if (!graveOptionId) return;
						const gravePick = graveOptions.find((option) => option.id === graveOptionId);
						if (!gravePick || typeof gravePick.pos !== "number") return;
						const live = String(owner.grave[gravePick.pos] || "");
						if (!live) return;
						const liveFreePos = firstEmptyFieldPos(owner);
						if (liveFreePos < 0) return;
						owner.grave.splice(gravePick.pos, 1);
						placeAllyOnField(state, ownerSlot, owner, live, liveFreePos, broadcast, askChoice);
						broadcast("effect_log", { slot: ownerSlot, cardId: reactionCardId, effect: "bem_treinado", text: `${reactionCardId}: invocou ${live} do cemitério.` });
					});
				}, () => {});
			});
		}
	}

	if (String(def?.effect || "") === "chamar_cidadao") {
		if (!reason?.fromCombat) return;
		const destroyedLooseName = normalizeLoose(String(def?.name || destroyedCardId || ""));
		const handMatches: number[] = [];
		for (let index = 0; index < owner.hand.length; index += 1) {
			const cid = String(owner.hand[index] || "");
			if (!cid) continue;
			const cardDef = findCardDef(cid);
			if (normalizeKind(String((cardDef as any)?.classe || "")) !== "cidadao") continue;
			if (normalizeLoose(String((cardDef as any)?.name || cid || "")) === destroyedLooseName) continue;
			handMatches.push(index);
		}
		if (!handMatches.length) return;
		const freePos = firstEmptyFieldPos(owner);
		if (freePos < 0) return;
		const options: ChoiceOption[] = handMatches.map((idx, order) => {
			const cid = String(owner.hand[idx] || "");
			return { id: `bartolomeu-${idx}-${order}`, label: cid, side: ownerSlot, lane: "support", pos: idx, cardId: cid };
		});
		askChoice(ownerSlot, { title: `${destroyedCardId}: escolha um Cidadão da mão para invocar`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			const live = String(owner.hand[pick.pos] || "");
			if (!live) return;
			const freePos2 = firstEmptyFieldPos(owner);
			if (freePos2 < 0) return;
			owner.hand.splice(pick.pos, 1);
			placeAllyOnField(state, ownerSlot, owner, live, freePos2, broadcast, askChoice);
			broadcast("effect_log", { slot: ownerSlot, cardId: destroyedCardId, effect: "chamar_cidadao", text: `${destroyedCardId}: invocou ${live} da mão ao ser derrotado em combate.` });
		});
	}

	const destroyedName = normalizeKind(String(def?.name || destroyedCardId || ""));
	const isHiena = destroyedName.includes("hiena") && destroyedName.includes("carniceira");
	if (isHiena && reason?.fromCombat) {
		const pos = firstEmptyFieldPos(owner);
		if (pos < 0) return;
		const graveOptions: ChoiceOption[] = [];
		for (let index = 0; index < owner.grave.length; index += 1) {
			const cid = String(owner.grave[index] || "");
			if (!cid) continue;
			const cardDef = findCardDef(String(cid || ""));
			if (!cardDef) continue;
			if (!isAllyKind((cardDef as any)?.kind || (cardDef as any)?.tipo)) continue;
			const cost = Number((cardDef as any)?.cost || 0);
			if (!Number.isFinite(cost) || cost > 3) continue;
			graveOptions.push({ id: `hiena-${index}`, label: cid, side: ownerSlot, lane: "grave", pos: index, cardId: cid });
		}
		if (!graveOptions.length) return;
		askChoice(ownerSlot, { title: `${destroyedCardId}: escolha aliado (custo 3 ou menos) do cemitério`, options: graveOptions, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = graveOptions.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			const live = String(owner.grave[pick.pos] || "");
			if (!live) return;
			const freePos2 = firstEmptyFieldPos(owner);
			if (freePos2 < 0) return;
			owner.grave.splice(pick.pos, 1);
			placeAllyOnField(state, ownerSlot, owner, live, freePos2, broadcast, askChoice);
			broadcast("effect_log", { slot: ownerSlot, cardId: destroyedCardId, effect: "hiena_carniceira", text: `${destroyedCardId}: invocou ${live} do cemitério.` });
		});
	}
}
function triggerSupportSentToGrave(state: MatchState, ownerSlot: Slot, supportCardId: string, broadcast: (name: string, payload: any) => void): void {
	const owner = asPlayer(state, ownerSlot);
	const opponent = asPlayer(state, enemySlot(ownerSlot));
	const def = findCardDef(supportCardId) as any;
	if (String(def?.effect || "") === "on_grave_damage_leader") {
		const value = Math.max(1, Number(def?.effectValue || 2));
		applyDamageToLeader(opponent, value);
		broadcast("effect_log", { slot: ownerSlot, cardId: supportCardId, effect: "on_grave_damage_leader", text: `${supportCardId}: causou ${value} de dano ao líder inimigo ao ir para o cemitério.` });
		if (opponent.hp <= 0) {
			state.phase = "FINISHED";
			state.game.seq += 1;
			broadcast("match_ended", { winner: ownerSlot, loser: enemySlot(ownerSlot), p1Hp: state.game.p1.hp, p2Hp: state.game.p2.hp, seq: state.game.seq });
		}
	}
}

function destroySupportAt(state: MatchState, ownerSlot: Slot, pos: number, broadcast: (name: string, payload: any) => void): string {
	const owner = asPlayer(state, ownerSlot);
	const removed = String(owner.support[pos] || "");
	if (!removed) return "";
	const attachedTo = supportAttachedTo(owner as any, pos);
	clearSupportAt(owner as any, pos);
	removeAttachedSupportHpBonus(state, ownerSlot, attachedTo, removed);
	owner.grave.push(removed);
	triggerSupportSentToGrave(state, ownerSlot, removed, broadcast);
	return removed;
}

function destroyEnv(state: MatchState, ownerSlot: Slot, broadcast: (name: string, payload: any) => void, askChoice: AskChoiceFn): string {
	const owner = asPlayer(state, ownerSlot);
	const removed = String(owner.env || "");
	if (!removed) return "";
	if (String(findCardDef(removed)?.effect || "") === "religioso_protecao") {
		clearCatedralBlessing(state, ownerSlot, broadcast, askChoice);
	}
	owner.env = "";
	owner.grave.push(removed);
	return removed;
}

function maybeOfferCounterToActivation(
	state: MatchState,
	activatingSlot: Slot,
	activatedCardId: string,
	broadcast: (name: string, payload: any) => void,
	askChoice: AskChoiceFn,
	onContinue: () => void,
	onCancelled: () => void
): void {
	const activatedDef = findCardDef(activatedCardId);
	if (!isSpellOrTrickKind(activatedDef?.kind || activatedDef?.tipo)) {
		onContinue();
		return;
	}
	const defenderSlot = enemySlot(activatingSlot);
	const defender = asPlayer(state, defenderSlot);
	const counterOptions: ChoiceOption[] = [];
	for (let index = 0; index < defender.hand.length; index += 1) {
		const cid = String(defender.hand[index] || "");
		if (!cid) continue;
		if (String(findCardDef(cid)?.effect || "") !== "anular_magia_truque") continue;
		const cost = getCardCost(cid);
		if (Number(defender.fragments || 0) < cost) continue;
		counterOptions.push({
			id: `counter-${index}`,
			label: `Ativar ${cid}`,
			description: `Pagar ${cost} fragmento(s) para anular ${activatedCardId}.`,
			side: defenderSlot,
			lane: "support",
			pos: index,
			cardId: cid
		});
	}
	if (!counterOptions.length) {
		onContinue();
		return;
	}
	askChoice(
		defenderSlot,
		{
			title: `Interrupção Perfeita: deseja anular ${activatedCardId}?`,
			options: [...counterOptions, { id: "counter-no", label: "Não ativar", description: `Deixar ${activatedCardId} resolver normalmente.` }],
			allowCancel: true
		},
		(optionId) => {
			if (!optionId || optionId === "counter-no") {
				onContinue();
				return;
			}
			const pick = counterOptions.find((option) => option.id === optionId);
			if (!pick || !pick.cardId) {
				onContinue();
				return;
			}
			const counterCardId = String(pick.cardId || "");
			const counterCost = getCardCost(counterCardId);
			const liveCounterIndex = defender.hand.findIndex((cid: string) => String(cid || "") === counterCardId);
			if (liveCounterIndex < 0 || Number(defender.fragments || 0) < counterCost) {
				onContinue();
				return;
			}
			defender.fragments -= counterCost;
			defender.hand.splice(liveCounterIndex, 1);
			defender.grave.push(counterCardId);
			maybeOfferCounterToActivation(
				state,
				defenderSlot,
				counterCardId,
				broadcast,
				askChoice,
				() => {
					broadcast("effect_log", { slot: defenderSlot, cardId: counterCardId, effect: "anular_magia_truque", text: `${counterCardId}: anulou o efeito de ${activatedCardId}.` });
					onCancelled();
				},
				() => {
					onContinue();
				}
			);
		}
	);
}

function destroyAttachedSupports(state: MatchState, ownerSlot: Slot, targetPos: number, broadcast: (name: string, payload: any) => void): void {
	const owner = asPlayer(state, ownerSlot) as any;
	for (let index = owner.support.length - 1; index >= 0; index -= 1) {
		const cid = String(owner.support[index] || "");
		if (!cid) continue;
		if (supportAttachedTo(owner, index) !== targetPos) continue;
		destroySupportAt(state, ownerSlot, index, broadcast);
	}
}

function getPlayerEnvEffect(state: MatchState, slot: Slot): string {
	const p = asPlayer(state, slot);
	const envId = String(p.env || "");
	if (!envId) return "";
	return String(findCardDef(envId)?.effect || "");
}

function hasAnyEnvEffect(state: MatchState, effect: string): boolean {
	const expected = String(effect || "");
	if (!expected) return false;
	for (const slot of ["p1", "p2"] as Slot[]) {
		if (getPlayerEnvEffect(state, slot) === expected) return true;
	}
	return false;
}

function leaderHasFiliation(state: MatchState, slot: Slot, expected: string): boolean {
	const p = asPlayer(state, slot);
	const def = findCardDef(String(p.leaderId || ""));
	return normalizeLoose(String(def?.filiacao || "")).includes(normalizeLoose(expected));
}

function hasShadowPenaltyForSlot(state: MatchState, slot: Slot): boolean {
	return hasAnyEnvEffect(state, "sombra_penalty") && !leaderHasFiliation(state, slot, "Sombras");
}

function getEffectiveFragmentCap(state: MatchState, slot: Slot): number {
	const p = asPlayer(state, slot) as any;
	const baseCap = Math.max(0, Number(p.fragmentMax || 0));
	return Math.max(0, baseCap - (hasShadowPenaltyForSlot(state, slot) ? 1 : 0));
}

function clampFragmentsToEffectiveCap(state: MatchState, slot: Slot): void {
	const p = asPlayer(state, slot) as any;
	p.fragments = Math.min(Math.max(0, Number(p.fragments || 0)), getEffectiveFragmentCap(state, slot));
}

function clampAllPlayersFragmentsToEffectiveCap(state: MatchState): void {
	for (const slot of ["p1", "p2"] as Slot[]) clampFragmentsToEffectiveCap(state, slot);
}

function cardHasFiliation(cardId: string, expected: string): boolean {
	const def = findCardDef(cardId);
	return normalizeLoose(String(def?.filiacao || "")).includes(normalizeLoose(expected));
}

function cardHasClasse(cardId: string, expected: string): boolean {
	const def = findCardDef(cardId);
	return normalizeLoose(String(def?.classe || "")).includes(normalizeLoose(expected));
}

function isMarcialCharacter(cardId: string): boolean {
	return cardHasFiliation(cardId, "Marcial");
}

function hasProtected(cardId: string): boolean {
	const card = findCardDef(cardId) as any;
	if (card?.protegido) return true;
	const text = normalizeKind(String(card?.text || ""));
	return text.includes("protegido");
}

function getTargetResistance(state: MatchState, targetSlot: Slot, target: AttackTarget): number {
	if (target.type === "leader") {
		const p = asPlayer(state, targetSlot);
		let total = 0;
		total += getAttachedSupportNumericBonus(p, null, "acBonus");
		return total;
	}
	const p = asPlayer(state, targetSlot);
	const cardId = String(p.field[target.targetPos] || "");
	const def = findCardDef(cardId);
	const ac = Number(def?.ac);
	let total = Number.isFinite(ac) ? Math.max(0, ac) : 10;
	total += getFieldAcPermBonus(p, target.targetPos);
	total += getAttachedSupportNumericBonus(p, target.targetPos, "acBonus");
	return total;
}

function hasMarcialEnvAttackBonus(state: MatchState, slot: Slot, attackerId: string): boolean {
	return hasAnyEnvEffect(state, "marcial_bonus")
		&& leaderHasFiliation(state, slot, "Marcial")
		&& isMarcialCharacter(attackerId);
}

function offerCatedralBlessing(state: MatchState, slot: Slot, broadcast: (name: string, payload: any) => void, askChoice?: AskChoiceFn): void {
	if (!askChoice) return;
	if (getPlayerEnvEffect(state, slot) !== "religioso_protecao") return;
	if (!leaderHasFiliation(state, slot, "Religioso")) return;
	const player = asPlayer(state, slot) as any;
	const envCardId = String(player.env || "");
	const options: ChoiceOption[] = [];
	for (let pos = 0; pos < player.field.length; pos += 1) {
		const cid = String(player.field[pos] || "");
		if (!cid) continue;
		options.push({ id: `catedral-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid, description: "Recebe +2 de vida até o início do seu próximo turno." });
	}
	if (!options.length) return;
	askChoice(slot, { title: `${envCardId || "Catedral Ensolarada"}: escolha um aliado para receber +2 de vida`, options, allowCancel: true }, (optionId) => {
		if (!optionId) return;
		const pick = options.find((option) => option.id === optionId);
		if (!pick || typeof pick.pos !== "number") return;
		player.leaderBlessing = 0;
		for (let index = 0; index < player.fieldBlessing.length; index += 1) player.fieldBlessing[index] = 0;
		const currentHp = Number(player.fieldHp[pick.pos] || 0);
		const bonusHp = 2;
		player.fieldBlessing[pick.pos] = bonusHp;
		const boostedMaxHp = getFieldMaxHp(state, slot, pick.pos);
		player.fieldHp[pick.pos] = Math.min(boostedMaxHp, currentHp + bonusHp);
		broadcast("effect_log", { slot, cardId: envCardId, effect: "religioso_protecao", text: `${envCardId || "Catedral Ensolarada"}: ${pick.cardId} recebeu +2 de vida até o próximo turno.` });
	});
}

function clearCatedralBlessing(
	state: MatchState,
	slot: Slot,
	broadcast: (name: string, payload: any) => void,
	askChoice?: AskChoiceFn
): void {
	const player = asPlayer(state, slot) as any;
	for (let pos = 0; pos < player.field.length; pos += 1) {
		const blessing = Number(player.fieldBlessing?.[pos] || 0);
		if (!Number.isFinite(blessing) || blessing <= 0) continue;
		const cardId = String(player.field[pos] || "");
		player.fieldBlessing[pos] = 0;
		if (!cardId) continue;
		const currentHp = Number(player.fieldHp[pos] || 0);
		const remainingHp = currentHp - blessing;
		if (remainingHp > 0) {
			const maxHp = getFieldMaxHp(state, slot, pos);
			player.fieldHp[pos] = Math.min(maxHp, remainingHp);
			broadcast("effect_log", { slot, cardId, effect: "religioso_protecao", text: `${cardId}: perdeu o bônus de vida da Catedral Ensolarada.` });
			continue;
		}
		destroyAttachedSupports(state, slot, pos, broadcast);
		const removed = clearFieldSlotWithAuras(state, slot, pos);
		if (!removed) continue;
		player.grave.push(removed);
		if (askChoice) handleDestroyedAllyTriggers(state, slot, removed, broadcast, askChoice, { fromCombat: false });
		broadcast("effect_log", { slot, cardId: removed, effect: "religioso_protecao", text: `${removed}: perdeu o bônus de vida da Catedral Ensolarada e foi enviado ao cemitério.` });
	}
}

function getTargetHP(state: MatchState, targetSlot: Slot, targetPos: number): number {
	const p = asPlayer(state, targetSlot);
	const current = Number((p as any).fieldHp?.[targetPos] ?? 0);
	if (Number.isFinite(current) && current > 0) return current;
	return getFieldMaxHp(state, targetSlot, targetPos);
}

function isFirstTurnForSlot(game: MatchState["game"], slot: Slot): boolean {
	const turn = Number(game.turn || 1);
	if (slot === "p1") return Math.ceil(turn / 2) <= 1;
	return Math.floor(turn / 2) <= 1;
}

function hasKatsuWarriorException(state: MatchState, slot: Slot, attackerId: string): boolean {
	const owner = asPlayer(state, slot);
	const leaderDef = findCardDef(String(owner.leaderId || ""));
	const isKatsu = cardHasEffectId(leaderDef, "katsu")
		|| normalizeLoose(String(leaderDef?.key || "")) === "katsu"
		|| normalizeLoose(String(leaderDef?.name || owner.leaderId || "")).startsWith("katsu");
	const isWarrior = cardHasClasse(attackerId, "Guerreiro");
	return isKatsu && isWarrior;
}

function isFieldTapped(player: any, pos: number): boolean {
	return !!player?.fieldTapped?.[pos];
}

function canAttackServer(
	state: MatchState,
	slot: Slot,
	attackerPos: number,
	attacked: Record<Slot, Set<number>>,
	summoned: Record<Slot, Set<number>>
): boolean {
	if (state.game.phase !== "COMBAT") return false;
	if (isFirstTurnForSlot(state.game, slot)) return false;
	if (attackerPos < 0) return false;
	const me = asPlayer(state, slot);
	const attackerId = String(me.field[attackerPos] || "");
	const attackerDef = findCardDef(attackerId);
	if (attackerPos >= 0 && isFieldTapped(me as any, attackerPos)) return false;
	if (attackerPos >= 0 && summoned[slot].has(attackerPos) && !cardHasKeyword(attackerDef, "investida")) return false;
	if (attacked[slot].has(attackerPos)) return false;
	return true;
}

function asPlayer(state: MatchState, slot: Slot) {
	return slot === "p1" ? state.game.p1 : state.game.p2;
}

function enemySlot(slot: Slot): Slot {
	return slot === "p1" ? "p2" : "p1";
}

function firstEmptyFieldPos(player: any): number {
	for (let pos = 0; pos < player.field.length; pos += 1) {
		if (!String(player.field[pos] || "")) return pos;
	}
	return -1;
}

function clearFieldSlot(player: any, pos: number): string {
	const cid = String(player.field[pos] || "");
	player.field[pos] = "";
	player.fieldHp[pos] = 0;
	if (player.fieldTapped) player.fieldTapped[pos] = false;
	if (player.fieldFrozen) player.fieldFrozen[pos] = 0;
	if (player.fieldPinnedUntilTurn) player.fieldPinnedUntilTurn[pos] = 0;
	if (player.fieldAtkTemp) player.fieldAtkTemp[pos] = 0;
	if (player.fieldAtkPerm) player.fieldAtkPerm[pos] = 0;
	if (player.fieldAcPerm) player.fieldAcPerm[pos] = 0;
	if (player.fieldSedeMark) player.fieldSedeMark[pos] = 0;
	if (player.fieldBloodMarks) player.fieldBloodMarks[pos] = 0;
	if (player.fieldBlessing) player.fieldBlessing[pos] = 0;
	if (player.fieldVitalMarks) player.fieldVitalMarks[pos] = 0;
	return cid;
}

function clearFieldSlotWithAuras(state: MatchState, slot: Slot, pos: number): string {
	const player = asPlayer(state, slot) as any;
	const removedId = String(player.field[pos] || "");
	const removed = clearFieldSlot(player, pos);
	if (removedId) removeAuraHpBonusFromSource(state, slot, removedId);
	return removed;
}

function findDeckMatchIndices(deck: string[], query: any, maxResults: number): number[] {
	if (!deck || typeof (deck as any).length !== "number" || !(deck as any).length) return [];
	const out: number[] = [];
	const expectedName = normalizeKind(String(query?.name || ""));
	const expectedNameLoose = normalizeLoose(String(query?.name || ""));
	const expectedKind = normalizeKind(String(query?.kind || ""));
	const expectedClasse = normalizeKind(String(query?.classe || ""));
	const expectedTipo = normalizeKind(String(query?.tipo || ""));
	const expectedFiliacao = normalizeKind(String(query?.filiacao || ""));
	for (let index = deck.length - 1; index >= 0; index -= 1) {
		const cardId = deck[index];
		const card = findCardDef(cardId);
		if (!card) continue;
		if (query?.excludeName && String(card.name) === String(query.excludeName)) continue;
		const cardName = String(card.name || cardId || "");
		const nameMatches = !expectedName || normalizeKind(cardName).includes(expectedName) || normalizeLoose(cardName).includes(expectedNameLoose) || normalizeLoose(String(cardId || "")).includes(expectedNameLoose);
		if (!nameMatches) continue;
		if (expectedKind && normalizeKind(card.kind || card.tipo) !== expectedKind) continue;
		if (expectedClasse && normalizeKind(card.classe) !== expectedClasse) continue;
		if (expectedTipo && normalizeKind(card.tipo) !== expectedTipo) continue;
		if (expectedFiliacao && normalizeKind(card.filiacao) !== expectedFiliacao) continue;
		out.push(index);
		if (out.length >= maxResults) break;
	}
	return out;
}

function isLeaderPinned(state: MatchState, slot: Slot): boolean {
	return Number((asPlayer(state, slot) as any).leaderPinnedUntilTurn || 0) >= Number(state.game.turn || 0);
}

function isFieldPinned(state: MatchState, slot: Slot, pos: number): boolean {
	return Number((asPlayer(state, slot) as any).fieldPinnedUntilTurn?.[pos] || 0) >= Number(state.game.turn || 0);
}

function tryUntapField(state: MatchState, slot: Slot, pos: number): boolean {
	if (isFieldPinned(state, slot, pos)) return false;
	(asPlayer(state, slot) as any).fieldTapped[pos] = false;
	return true;
}

function triggerAutoEffects(
	state: MatchState,
	slot: Slot,
	cardId: string,
	cardDef: CardDef | undefined,
	broadcast: (name: string, payload: any) => void,
	askChoice: AskChoiceFn,
	context?: { lane?: "field" | "support" | "env"; pos?: number }
) {
	const effect = String(cardDef?.effect || "").trim();
	if (!effect) return;
	const me = asPlayer(state, slot);
	const foe = asPlayer(state, enemySlot(slot));

	if (effect === "olhar_topo") {
		const topIndex = me.deck.length - 1;
		if (topIndex < 0) return;
		const topCardId = String(me.deck[topIndex] || "");
		if (!topCardId) return;
		const options: ChoiceOption[] = [
			{ id: "keep-top", label: `${topCardId} (manter no topo)`, side: slot, lane: "deck", pos: topIndex, cardId: topCardId },
			{ id: "put-bottom", label: `${topCardId} (colocar no fundo)`, side: slot, lane: "deck", pos: topIndex, cardId: topCardId }
		];
		askChoice(slot, { title: `${cardId}: olhe o topo do deck`, options, allowCancel: true }, (optionId) => {
			if (optionId === "put-bottom") {
				const currentTop = me.deck.length - 1;
				if (currentTop >= 0) {
					const moved = String(me.deck[currentTop] || "");
					if (moved) {
						moveDeckCardToBottom(me, currentTop);
						broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: colocou ${moved} no fundo do deck.` });
						return;
					}
				}
			}
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: manteve ${topCardId} no topo do deck.` });
		});
		return;
	}

	if (effect === "informante_beco") {
		const topIndex = foe.deck.length - 1;
		if (topIndex < 0) return;
		const topCardId = String(foe.deck[topIndex] || "");
		if (!topCardId) return;
		broadcastRevealedTopCard(state, broadcast, {
			ownerSlot: enemySlot(slot),
			sourceSlot: slot,
			sourceCardId: cardId,
			cardId: topCardId,
			text: `${cardId}: revelou o topo do deck do oponente.`
		});
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: revelou ${topCardId} para ambos e a carta permaneceu no topo do deck inimigo.` });
		return;
	}

	if (effect === "dano_2_inimigo") {
		const foes: ChoiceOption[] = [];
		if (String(me.leaderId || "")) foes.push({ id: "target-self-leader", label: `Seu líder (${me.leaderId})`, side: slot, lane: "env", cardId: String(me.leaderId || "") });
		if (String(foe.leaderId || "")) foes.push({ id: "target-enemy-leader", label: `Líder inimigo (${foe.leaderId})`, side: enemySlot(slot), lane: "env", cardId: String(foe.leaderId || "") });
		for (let pos = 0; pos < me.field.length; pos += 1) {
			const cid = String(me.field[pos] || "");
			if (!cid) continue;
			foes.push({ id: `target-self-ally-${pos}`, label: `${cid} (seu campo)`, side: slot, lane: "field", pos, cardId: cid });
		}
		for (let pos = 0; pos < foe.field.length; pos += 1) {
			const cid = String(foe.field[pos] || "");
			if (!cid) continue;
			foes.push({ id: `target-enemy-ally-${pos}`, label: `${cid} (campo inimigo)`, side: enemySlot(slot), lane: "field", pos, cardId: cid });
		}
		if (!foes.length) return;
		askChoice(slot, { title: `${cardId}: escolha alvo para 2 de dano`, options: foes, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = foes.find((o) => o.id === optionId);
			if (!pick) return;
			const targetSlot = pick.side === slot ? slot : enemySlot(slot);
			const targetPlayer = asPlayer(state, targetSlot);
			if (pick.id === "target-self-leader" || pick.id === "target-enemy-leader") {
				applyDamageToLeader(targetPlayer, 2);
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou 2 de dano em ${pick.cardId}.` });
				if (targetPlayer.hp <= 0) {
					state.phase = "FINISHED";
					broadcast("match_ended", { winner: targetSlot === slot ? enemySlot(slot) : slot, loser: targetSlot, p1Hp: state.game.p1.hp, p2Hp: state.game.p2.hp, seq: state.game.seq });
				}
				return;
			}
			if (typeof pick.pos !== "number") return;
			const targetId = String(targetPlayer.field[pick.pos] || "");
			if (!targetId) return;
			const current = getTargetHP(state, targetSlot, pick.pos);
			const remaining = Math.max(0, current - 2);
			(targetPlayer as any).fieldHp[pick.pos] = remaining;
			if (remaining <= 0) {
				destroyAttachedSupports(state, targetSlot, pick.pos, broadcast);
				const removed = clearFieldSlotWithAuras(state, targetSlot, pick.pos);
				if (removed) {
					targetPlayer.grave.push(removed);
					handleDestroyedAllyTriggers(state, targetSlot, removed, broadcast, askChoice);
				}
			}
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou 2 de dano em ${targetId}.` });
		});
		return;
	}

	if (effect === "freeser") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: truque reativo pronto para negar um ataque inimigo.` });
		return;
	}

	if (effect === "aranhas_emboscada") {
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < foe.field.length; pos += 1) {
			const cid = String(foe.field[pos] || "");
			if (!cid) continue;
			options.push({ id: `emboscada-${pos}`, label: cid, side: enemySlot(slot), lane: "field", pos, cardId: cid });
		}
		if (!options.length) return;
		askChoice(slot, { title: `${cardId}: escolha inimigo para reduzir ATK`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number") return;
			(foe as any).fieldAtkTemp[pick.pos] = Number((foe as any).fieldAtkTemp[pick.pos] || 0) - 1;
			const hasAranhas = Array.from({ length: me.field.length }, (_, i) => String(me.field[i] || "")).some((name) => normalizeKind(name).replace(/[^a-z0-9]+/g, "").includes("aranhasnegras"));
			if (hasAranhas) {
				drawCard(state, slot, 1, broadcast);
				if (state.phase === "FINISHED") return;
			}
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: aplicou -1 de ATK temporário em ${String(foe.field[pick.pos] || "inimigo")}.` });
		});
		return;
	}

	if (effect === "anular_magia_truque") {
		const options: ChoiceOption[] = [];
		for (let i = 0; i < foe.hand.length; i += 1) {
			const cid = String(foe.hand[i] || "");
			if (!cid) continue;
			const def = findCardDef(cid);
			if (!isSpellOrTrickKind(def?.kind || def?.tipo)) continue;
			options.push({ id: `anular-${i}`, label: cid, side: enemySlot(slot), lane: "support", pos: i, cardId: cid });
		}
		if (!options.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: nenhuma magia/truque na mão inimiga para anular.` });
			return;
		}
		askChoice(slot, { title: `${cardId}: escolha magia/truque para anular`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number") return;
			const removed = String(foe.hand[pick.pos] || "");
			if (!removed) return;
			foe.hand.splice(pick.pos, 1);
			foe.grave.push(removed);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: anulou ${removed} da mão inimiga.` });
		});
		return;
	}

	if (effect === "bem_treinado") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: permanece na mão e aguarda a reação quando um aliado seu for ao cemitério.` });
		return;
	}

	if (effect === "raio_gelo") {
		const targets: ChoiceOption[] = [];
		if (String(foe.leaderId || "")) targets.push({ id: "tap-leader", label: `Líder (${foe.leaderId})`, side: enemySlot(slot), lane: "env", cardId: String(foe.leaderId || "") });
		for (let pos = 0; pos < foe.field.length; pos += 1) {
			const cid = String(foe.field[pos] || "");
			if (!cid) continue;
			targets.push({ id: `tap-ally-${pos}`, label: cid, side: enemySlot(slot), lane: "field", pos, cardId: cid });
		}
		if (!targets.length) return;
		askChoice(slot, { title: `${cardId}: escolha um inimigo para deitar`, options: targets, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = targets.find((o) => o.id === optionId);
			if (!pick) return;
			if (pick.id === "tap-leader") {
				(foe as any).leaderTapped = true;
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: deitou o líder inimigo.` });
				return;
			}
			if (typeof pick.pos !== "number") return;
			(foe as any).fieldTapped[pick.pos] = true;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: deitou ${String(foe.field[pick.pos] || "inimigo")}.` });
		});
		return;
	}

	if (effect === "espionagem_sorrateira") {
		if (!foe.hand.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: a mão inimiga está vazia.` });
			return;
		}
		const options: ChoiceOption[] = [];
		for (let i = 0; i < foe.hand.length; i += 1) {
			const cid = String(foe.hand[i] || "");
			if (!cid) continue;
			const def = findCardDef(cid);
			const filiacao = normalizeKind(String(def?.filiacao || ""));
			const discardable = ["religioso", "marcial", "arcana"].includes(filiacao);
			options.push({ id: `espiao-${i}`, label: cid, side: enemySlot(slot), lane: "support", pos: i, cardId: cid, disabled: !discardable, disabledReason: discardable ? undefined : "Esta carta não pode ser descartada por Espionagem Sorrateira." });
		}
		askChoice(slot, { title: `${cardId}: escolha carta para descartar`, options, allowCancel: true }, (optionId) => {
			if (!optionId) {
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: viu a mão inimiga e não descartou nenhuma carta.` });
				return;
			}
			const pick = options.find((o) => o.id === optionId);
			if (!pick || pick.disabled || typeof pick.pos !== "number") return;
			const removed = String(foe.hand[pick.pos] || "");
			if (!removed) return;
			foe.hand.splice(pick.pos, 1);
			foe.grave.push(removed);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: descartou ${removed} da mão inimiga.` });
		});
		return;
	}

	if (effect === "charlatao_da_vila") {
		const drawn = drawCard(state, slot, 1, broadcast);
		if (state.phase === "FINISHED") return;
		const options: ChoiceOption[] = [];
		for (let i = 0; i < me.hand.length; i += 1) {
			const cid = String(me.hand[i] || "");
			if (!cid) continue;
			options.push({ id: `charlatao-${i}`, label: cid, side: slot, lane: "support", pos: i, cardId: cid });
		}
		if (!options.length) {
			broadcast("effect_log", { slot, cardId, effect, text: drawn > 0 ? `${cardId}: comprou 1 carta, mas não havia carta na mão para descartar.` : `${cardId}: não foi possível comprar e não havia carta na mão para descartar.` });
			return;
		}
		askChoice(slot, { title: `${cardId}: escolha 1 carta da sua mão para descartar`, options, allowCancel: false }, (optionId) => {
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number") return;
			const removed = String(me.hand[pick.pos] || "");
			if (!removed) return;
			me.hand.splice(pick.pos, 1);
			me.grave.push(removed);
			broadcast("effect_log", { slot, cardId, effect, text: drawn > 0 ? `${cardId}: comprou 1 carta e descartou ${removed}.` : `${cardId}: descartou ${removed}.` });
		});
		return;
	}

	if (effect === "estudante_arcano") {
		if (!me.hand.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: sem cartas na mão para colocar no fundo do baralho.` });
			return;
		}
		const activateOptions: ChoiceOption[] = [
			{ id: "student-yes", label: "Ativar efeito", description: "Coloque 1 carta da mão no fundo do baralho e compre 1 carta." },
			{ id: "student-no", label: "Não ativar", description: "Não use o efeito agora." }
		];
		askChoice(slot, { title: `${cardId}: deseja ativar o efeito?`, options: activateOptions, allowCancel: true }, (activateId) => {
			if (!activateId || activateId === "student-no") {
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: você escolheu não ativar o efeito.` });
				return;
			}
			const handOptions: ChoiceOption[] = [];
			for (let i = 0; i < me.hand.length; i += 1) {
				const cid = String(me.hand[i] || "");
				if (!cid) continue;
				handOptions.push({ id: `student-hand-${i}`, label: cid, side: slot, lane: "support", pos: i, cardId: cid });
			}
			if (!handOptions.length) {
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: sem cartas na mão para colocar no fundo do baralho.` });
				return;
			}
			askChoice(slot, { title: `${cardId}: escolha uma carta da sua mão para colocar no fundo do baralho`, options: handOptions, allowCancel: true }, (optionId) => {
				if (!optionId) {
					broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: efeito cancelado.` });
					return;
				}
				const pick = handOptions.find((o) => o.id === optionId);
				if (!pick || typeof pick.pos !== "number") return;
				const removed = String(me.hand[pick.pos] || "");
				if (!removed) return;
				me.hand.splice(pick.pos, 1);
				const deckCards = Array.from(me.deck as ArrayLike<string>);
				deckCards.unshift(removed);
				setDeckCards(me, deckCards);
				const drawn = drawCard(state, slot, 1, broadcast);
				if (state.phase === "FINISHED") return;
				broadcast("effect_log", { slot, cardId, effect, text: drawn > 0 ? `${cardId}: colocou ${removed} no fundo do baralho e comprou 1 carta.` : `${cardId}: colocou ${removed} no fundo do baralho.` });
			});
		});
		return;
	}

	if (effect === "xama_kobold") {
		const koboldOptions: ChoiceOption[] = [];
		for (let i = 0; i < me.grave.length; i += 1) {
			const cid = String(me.grave[i] || "");
			if (!cid) continue;
			const def = findCardDef(cid);
			const name = String(def?.name || cid || "");
			if (!normalizeKind(name).includes("kobold")) continue;
			koboldOptions.push({ id: `xama-kobold-${i}`, label: cid, side: slot, lane: "grave", pos: i, cardId: cid, description: `Deslocar ${cid} do seu cemitério.` });
		}
		if (!koboldOptions.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: não havia aliado com "Kobold" no nome no seu cemitério.` });
			return;
		}
		const activateOptions: ChoiceOption[] = [
			{ id: "xama-yes", label: "Ativar efeito", description: "Desloque 1 Kobold do seu cemitério e compre 1 carta." },
			{ id: "xama-no", label: "Não ativar", description: "Não use o efeito agora." }
		];
		askChoice(slot, { title: `${cardId}: deseja ativar o efeito?`, options: activateOptions, allowCancel: true }, (activateId) => {
			if (!activateId || activateId === "xama-no") {
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: você escolheu não ativar o efeito.` });
				return;
			}
			askChoice(slot, { title: `${cardId}: escolha um Kobold do seu cemitério para deslocar`, options: koboldOptions, allowCancel: true }, (optionId) => {
				if (!optionId) {
					broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: efeito cancelado.` });
					return;
				}
				const pick = koboldOptions.find((o) => o.id === optionId);
				if (!pick || typeof pick.pos !== "number") return;
				const live = String(me.grave[pick.pos] || "");
				if (!live) return;
				me.grave.splice(pick.pos, 1);
				(me as any).banished.push(live);
				const drawn = drawCard(state, slot, 1, broadcast);
				if (state.phase === "FINISHED") return;
				broadcast("effect_log", { slot, cardId, effect, text: drawn > 0 ? `${cardId}: deslocou ${live} do cemitério e comprou 1 carta.` : `${cardId}: deslocou ${live} do cemitério.` });
			});
		});
		return;
	}

	if (effect === "blood_sacrifice") {
		const ownCharacters: ChoiceOption[] = [];
		if (String(me.leaderId || "") && Number(me.hp || 0) >= 2) ownCharacters.push({ id: "blood-own-leader", label: `Líder (${me.leaderId})`, side: slot, lane: "env", cardId: String(me.leaderId || "") });
		for (let pos = 0; pos < me.field.length; pos += 1) {
			const cid = String(me.field[pos] || "");
			if (!cid) continue;
			const hp = getTargetHP(state, slot, pos);
			if (hp < 2) continue;
			ownCharacters.push({ id: `blood-own-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!ownCharacters.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: sem personagem seu com vida suficiente para receber 2 de dano.` });
			return;
		}
		askChoice(slot, { title: `${cardId}: escolha personagem seu para receber 2 de dano`, options: ownCharacters, allowCancel: true }, (costOptionId) => {
			if (!costOptionId) return;
			const costPick = ownCharacters.find((o) => o.id === costOptionId);
			if (!costPick) return;
			let payerId = "";
			if (costPick.id === "blood-own-leader") {
				payerId = String(me.leaderId || "");
				applyDamageToLeader(me, 2);
				if (me.hp <= 0) {
					state.phase = "FINISHED";
					broadcast("match_ended", { winner: enemySlot(slot), loser: slot, p1Hp: state.game.p1.hp, p2Hp: state.game.p2.hp, seq: state.game.seq });
					return;
				}
			} else {
				if (typeof costPick.pos !== "number") return;
				payerId = String(me.field[costPick.pos] || "");
				if (!payerId) return;
				const payerHp = getTargetHP(state, slot, costPick.pos);
				const payerRemaining = Math.max(0, payerHp - 2);
				(me as any).fieldHp[costPick.pos] = payerRemaining;
				if (payerRemaining <= 0) {
					destroyAttachedSupports(state, slot, costPick.pos, broadcast);
					const removed = clearFieldSlotWithAuras(state, slot, costPick.pos);
					if (removed) {
						me.grave.push(removed);
						handleDestroyedAllyTriggers(state, slot, removed, broadcast, askChoice);
					}
				}
			}

			const enemies: ChoiceOption[] = [];
			if (String(foe.leaderId || "")) enemies.push({ id: "blood-target-leader", label: `Líder (${foe.leaderId})`, side: enemySlot(slot), lane: "env", cardId: String(foe.leaderId || "") });
			for (let pos = 0; pos < foe.field.length; pos += 1) {
				const cid = String(foe.field[pos] || "");
				if (!cid) continue;
				enemies.push({ id: `blood-target-ally-${pos}`, label: cid, side: enemySlot(slot), lane: "field", pos, cardId: cid });
			}
			if (!enemies.length) return;
			askChoice(slot, { title: `${cardId}: escolha personagem inimigo para 4 de dano`, options: enemies, allowCancel: true }, (targetOptionId) => {
				if (!targetOptionId) return;
				const targetPick = enemies.find((o) => o.id === targetOptionId);
				if (!targetPick) return;
				if (targetPick.id === "blood-target-leader") {
					applyDamageToLeader(foe, 4);
					broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou 2 de dano em ${payerId} e 4 no líder inimigo.` });
					if (foe.hp <= 0) {
						state.phase = "FINISHED";
						broadcast("match_ended", { winner: slot, loser: enemySlot(slot), p1Hp: state.game.p1.hp, p2Hp: state.game.p2.hp, seq: state.game.seq });
					}
					return;
				}
				if (typeof targetPick.pos !== "number") return;
				const targetId = String(foe.field[targetPick.pos] || "");
				if (!targetId) return;
				const hp = getTargetHP(state, enemySlot(slot), targetPick.pos);
				const remaining = Math.max(0, hp - 4);
				(foe as any).fieldHp[targetPick.pos] = remaining;
				if (remaining <= 0) {
					destroyAttachedSupports(state, enemySlot(slot), targetPick.pos, broadcast);
					const removed = clearFieldSlotWithAuras(state, enemySlot(slot), targetPick.pos);
					if (removed) {
						foe.grave.push(removed);
						handleDestroyedAllyTriggers(state, enemySlot(slot), removed, broadcast, askChoice);
					}
				}
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou 2 de dano em ${payerId} e 4 em ${targetId}.` });
			});
		});
		return;
	}

	if (effect === "destroy_equip") {
		const equips: ChoiceOption[] = [];
		for (const s of ["p1", "p2"] as Slot[]) {
			const p = asPlayer(state, s);
			for (let pos = 0; pos < p.support.length; pos += 1) {
				const cid = String(p.support[pos] || "");
				if (!cid) continue;
				const def = findCardDef(cid);
				if (!isEquipKind(def?.kind || def?.tipo)) continue;
				equips.push({ id: `equip-${s}-${pos}`, label: cid, side: s, lane: "support", pos, cardId: cid });
			}
		}
		if (!equips.length) return;
		askChoice(slot, { title: `${cardId}: escolha equipamento para destruir`, options: equips, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = equips.find((o) => o.id === optionId);
			if (!pick || !pick.side || typeof pick.pos !== "number" || !pick.cardId) return;
			destroySupportAt(state, pick.side, pick.pos, broadcast);
			if (state.phase === "FINISHED") return;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: destruiu ${pick.cardId}.` });
		});
		return;
	}

	if (effect === "destroy_env") {
		const envs: ChoiceOption[] = [];
		for (const s of ["p1", "p2"] as Slot[]) {
			const p = asPlayer(state, s);
			const envCardId = String(p.env || "");
			if (!envCardId) continue;
			envs.push({ id: `env-${s}`, label: envCardId, side: s, lane: "env", cardId: envCardId });
		}
		if (!envs.length) return;
		askChoice(slot, { title: `${cardId}: escolha ambiente para destruir`, options: envs, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = envs.find((o) => o.id === optionId);
			if (!pick || !pick.side || !pick.cardId) return;
			const removed = destroyEnv(state, pick.side, broadcast, askChoice);
			if (!removed) return;
			if (state.phase === "FINISHED") return;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: destruiu o ambiente ${pick.cardId}.` });
		});
		return;
	}

	if (effect === "destroy_enemy_ally") {
		const targets: ChoiceOption[] = [];
		for (let pos = 0; pos < foe.field.length; pos += 1) {
			const cid = String(foe.field[pos] || "");
			if (!cid) continue;
			targets.push({ id: `destroy-enemy-ally-${pos}`, label: cid, side: enemySlot(slot), lane: "field", pos, cardId: cid });
		}
		if (!targets.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: nenhum aliado inimigo em campo para destruir.` });
			return;
		}
		askChoice(slot, { title: `${cardId}: escolha um aliado inimigo para destruir`, options: targets }, (optionId) => {
			if (!optionId) return;
			const pick = targets.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			destroyAttachedSupports(state, enemySlot(slot), pick.pos, broadcast);
			const removed = clearFieldSlotWithAuras(state, enemySlot(slot), pick.pos);
			if (!removed) return;
			foe.grave.push(removed);
			handleDestroyedAllyTriggers(state, enemySlot(slot), removed, broadcast, askChoice);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: destruiu ${removed}.` });
		});
		return;
	}

	if (effect === "aranhas_informante") {
		const ownLeader = String(me.leaderId || "");
		if (ownLeader) {
			applyDamageToLeader(me, 4);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou 4 de dano ao seu escolhido.` });
			if (me.hp <= 0) {
				state.phase = "FINISHED";
				broadcast("match_ended", { winner: enemySlot(slot), loser: slot, p1Hp: state.game.p1.hp, p2Hp: state.game.p2.hp, seq: state.game.seq });
				return;
			}
		}
		if (foe.hand.length > 0) {
			const idx = Math.floor(Math.random() * foe.hand.length);
			const removed = String(foe.hand[idx] || "");
			if (removed) {
				foe.hand.splice(idx, 1);
				foe.grave.push(removed);
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: fez o oponente descartar 1 carta aleatória.` });
			}
		}
		return;
	}

	if (effect === "aranhas_mascote") {
		const tokenId = "token_aranhas";
		let created = 0;
		for (let pos = 0; pos < me.field.length; pos += 1) {
			if (created >= 2) break;
			if (String(me.field[pos] || "")) continue;
			summonGeneratedToken(state, slot, me as any, tokenId, pos, broadcast, askChoice);
			created += 1;
		}
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: criou ${created} ficha(s) de Aranhas Negras.` });
		return;
	}

	if (effect === "agiota") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: habilidade passiva pronta para ser usada como custo alternativo uma vez por turno.` });
		return;
	}

	if (effect === "ally_heal_buff") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: ganhará marcadores de Elo Vital sempre que um aliado seu for curado.` });
		return;
	}

	if (effect === "kornex_buff_per_marcial_in_play") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: bônus aplicado dinamicamente durante ataques.` });
		return;
	}

	if (effect === "ajuda_do_povo") {
		const tokenId = "Cidadãos Unidos";
		let created = 0;
		for (let pos = 0; pos < me.field.length && created < 2; pos += 1) {
			if (String(me.field[pos] || "")) continue;
			summonGeneratedToken(state, slot, me as any, tokenId, pos, broadcast, askChoice);
			created += 1;
		}
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: criou ${created} ficha(s) de ${tokenId}.` });
		return;
	}

	if (effect === "search_deck") {
		const query = cardDef?.query || {};
		const maxResults = Math.max(1, Number(cardDef?.max || 10));
		const indices = findDeckMatchIndices((me.deck as any) as string[], query, maxResults);
		if (!indices.length) {
			// Depuração: mostre amostra do deck e resolução de lookup para ajudar a diagnosticar
			const sample: string[] = [];
			for (let i = Math.max(0, (me.deck as any).length - 20); i < (me.deck as any).length; i += 1) {
				const cid = String((me.deck as any)[i] || "");
				if (!cid) continue;
				const def = findCardDef(cid);
				sample.push(`${i}:${cid}->${def ? def.name : "<undef>"}`);
			}
			const sampleText = sample.length ? sample.join(", ") : "<vazio>";
			const msg = `${cardId}: nenhuma carta compatível encontrada no deck. deck-sample(last20): ${sampleText}`;
			console.warn("[search_deck] ", msg);
			broadcast("effect_log", { slot, cardId, effect, text: msg });
			return;
		}
		const options: ChoiceOption[] = indices.map((idx, order) => {
			const cid = String(me.deck[idx] || "");
			return { id: `deck-${idx}-${order}`, label: cid, side: slot, lane: "deck", pos: idx, cardId: cid };
		});
		askChoice(
			slot,
			{ title: String((cardDef as any)?.title || `${cardId}: escolha uma carta do deck`), options, allowCancel: true },
			(optionId) => {
				if (!optionId) return;
				const pick = options.find((o) => o.id === optionId);
				if (!pick || typeof pick.pos !== "number") return;
				const found = String(me.deck[pick.pos] || "");
				if (!found) return;
				removeDeckCardAt(me, pick.pos);
				me.hand.push(found);
				if ((cardDef as any)?.shuffleAfter) {
					const deckCards = Array.from(me.deck as ArrayLike<string>);
					shuffle(deckCards);
					setDeckCards(me, deckCards);
				}
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: buscou ${found} para a mão.` });
			}
		);
		return;
	}

	if (effect === "discard_enemy_hand") {
		if (context?.lane !== "field") return;
		const len = foe.hand.length;
		if (len > 0) {
			const options: ChoiceOption[] = [];
			for (let i = 0; i < foe.hand.length; i += 1) {
				const cid = String(foe.hand[i] || "");
				if (!cid) continue;
				options.push({ id: `hand-${i}`, label: cid, side: enemySlot(slot), lane: "support", pos: i, cardId: cid });
			}
			askChoice(slot, { title: `${cardId}: escolha carta da mão do oponente para descartar`, options, allowCancel: true }, (optionId) => {
				if (!optionId) return;
				const pick = options.find((o) => o.id === optionId);
				if (!pick || typeof pick.pos !== "number") return;
				const removed = foe.hand[pick.pos];
				if (!removed) return;
				foe.hand.splice(pick.pos, 1);
				foe.grave.push(removed);
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: descartou ${removed} da mão inimiga.` });
			});
		}
		return;
	}

	if (effect === "destroy_equip_on_enter") {
		const candidates: Array<{ side: Slot; pos: number; cardId: string }> = [];
		for (let pos = 0; pos < foe.support.length; pos += 1) {
			const cid = String(foe.support[pos] || "");
			if (!cid) continue;
			const def = findCardDef(cid);
			if (isEquipKind(def?.kind || def?.tipo)) candidates.push({ side: enemySlot(slot), pos, cardId: cid });
		}
		if (!candidates.length) return;
		const options: ChoiceOption[] = candidates.map((c, idx) => ({ id: `equip-${idx}`, label: c.cardId, side: c.side, lane: "support", pos: c.pos, cardId: c.cardId }));
		askChoice(slot, { title: `${cardId}: escolha equipamento para destruir`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || pick.side == null || pick.pos == null || !pick.cardId) return;
			destroySupportAt(state, pick.side, pick.pos, broadcast);
			if (state.phase === "FINISHED") return;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: destruiu equipamento ${pick.cardId}.` });
		});
		return;
	}

	if (effect === "damage_ally_on_enter") {
		const lane = context?.lane || "field";
		const own = asPlayer(state, slot);
		if (lane !== "field") return;
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < own.field.length; pos += 1) {
			const cid = String(own.field[pos] || "");
			if (!cid) continue;
			if (typeof context?.pos === "number" && pos === context.pos) continue;
			options.push({ id: `ally-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!options.length) return;
		const dmg = Number(cardDef?.effectValue || 1);
		askChoice(slot, { title: `${cardId}: escolha aliado para receber ${dmg} de dano`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || pick.pos == null || !pick.cardId) return;
			const targetCardId = String(own.field[pick.pos] || "");
			if (!targetCardId) return;
			const currentHp = getTargetHP(state, slot, pick.pos);
			const remainingHp = Math.max(0, currentHp - dmg);
			(own as any).fieldHp[pick.pos] = remainingHp;
			if (remainingHp <= 0) {
				destroyAttachedSupports(state, slot, pick.pos, broadcast);
				const removed = clearFieldSlotWithAuras(state, slot, pick.pos);
				if (removed) {
					own.grave.push(removed);
					handleDestroyedAllyTriggers(state, slot, removed, broadcast, askChoice);
				}
			}
			drawCard(state, slot, 1, broadcast);
			if (state.phase === "FINISHED") return;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou ${dmg} de dano em ${targetCardId} e você comprou 1 carta.` });
		});
		return;
	}

	if (effect === "ban_on_enter") {
		const options: ChoiceOption[] = [];
		for (const s of ["p1", "p2"] as Slot[]) {
			const p = asPlayer(state, s);
			for (let pos = 0; pos < p.field.length; pos += 1) {
				const cid = String(p.field[pos] || "");
				if (cid) options.push({ id: `field-${s}-${pos}`, label: `${cid} (campo ${s})`, side: s, lane: "field", pos, cardId: cid });
			}
			for (let pos = 0; pos < p.support.length; pos += 1) {
				const cid = String(p.support[pos] || "");
				if (cid) options.push({ id: `support-${s}-${pos}`, label: `${cid} (suporte ${s})`, side: s, lane: "support", pos, cardId: cid });
			}
			const env = String(p.env || "");
			if (env) options.push({ id: `env-${s}`, label: `${env} (ambiente ${s})`, side: s, lane: "env", cardId: env });
		}
		if (!options.length) return;
		askChoice(slot, { title: `${cardId}: escolha carta para deslocar`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || !pick.side || !pick.lane || !pick.cardId) return;
			const p = asPlayer(state, pick.side);
			if (pick.lane === "field" && typeof pick.pos === "number") {
				destroyAttachedSupports(state, pick.side, pick.pos, broadcast);
				clearFieldSlotWithAuras(state, pick.side, pick.pos);
			}
			if (pick.lane === "support" && typeof pick.pos === "number") clearSupportAt(p as any, pick.pos);
			if (pick.lane === "env") {
				if (String(findCardDef(pick.cardId)?.effect || "") === "religioso_protecao") clearCatedralBlessing(state, pick.side, broadcast, askChoice);
				p.env = "";
			}
			clampAllPlayersFragmentsToEffectiveCap(state);
			(p as any).banished.push(pick.cardId);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: deslocou ${pick.cardId}.` });
		});
		return;
	}

	if (effect === "curar_animal") {
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < me.field.length; pos += 1) {
			const cid = String(me.field[pos] || "");
			if (!cid) continue;
			if (typeof context?.pos === "number" && pos === context.pos) continue;
			const def = findCardDef(cid);
			if (normalizeKind(String(def?.tipo || "")) !== "animal") continue;
			options.push({ id: `heal-animal-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!options.length) return;
		const heal = Math.max(1, Number(cardDef?.effectValue || 1));
		askChoice(slot, { title: `${cardId}: escolha animal para curar`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			const current = getTargetHP(state, slot, pick.pos);
			const maxHp = getCardDynamicMaxHp(state, slot, pick.cardId);
			(me as any).fieldHp[pick.pos] = Math.min(maxHp, current + heal);
			triggerLeafaeOnAllyHeal(state, slot, broadcast, cardId);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: curou ${heal} de vida de ${pick.cardId}.` });
		});
		return;
	}

	if (effect === "amizade_floresta") {
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < me.field.length; pos += 1) {
			const cid = String(me.field[pos] || "");
			if (!cid) continue;
			const def = findCardDef(cid) as any;
			if (normalizeKind(String(def?.tipo || "")) !== "animal") continue;
			options.push({ id: `amizade-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!options.length) return;
		askChoice(slot, { title: `${cardId}: escolha um animal aliado`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			const damageToAnimal = Math.max(1, Number((cardDef as any)?.effectValue?.damageToAnimal || 2));
			const healLeader = Math.max(1, Number((cardDef as any)?.effectValue?.healValue || 4));
			const hp = getTargetHP(state, slot, pick.pos);
			const remaining = Math.max(0, hp - damageToAnimal);
			(me as any).fieldHp[pick.pos] = remaining;
			if (remaining <= 0) {
				destroyAttachedSupports(state, slot, pick.pos, broadcast);
				const removed = clearFieldSlotWithAuras(state, slot, pick.pos);
				if (removed) {
					me.grave.push(removed);
					handleDestroyedAllyTriggers(state, slot, removed, broadcast, askChoice);
				}
			}
			me.hp = Math.min(getCardDynamicMaxHp(state, slot, String(me.leaderId || "")), Number(me.hp || 0) + healLeader);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causou ${damageToAnimal} em ${pick.cardId} e curou ${healLeader} do líder.` });
		});
		return;
	}

	if (effect === "sede_vinganca") {
		const turnToken = Number(state.game.turn || 0) * 10 + (slot === "p1" ? 1 : 2);
		if (Number((me as any).sedeVingancaTurn || 0) === turnToken) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: esta magia não pode ser ativada novamente neste turno.` });
			return;
		}
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < me.field.length; pos += 1) {
			const cid = String(me.field[pos] || "");
			if (!cid) continue;
			const def = findCardDef(cid) as any;
			if (normalizeKind(String(def?.classe || "")) !== "guerreiro") continue;
			options.push({ id: `sede-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!options.length) return;
		const buff = Math.max(1, Number(cardDef?.effectValue || 3));
		askChoice(slot, { title: `${cardId}: escolha um Guerreiro aliado`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			(me as any).sedeVingancaTurn = turnToken;
			(me as any).fieldAtkTemp[pick.pos] = Number((me as any).fieldAtkTemp[pick.pos] || 0) + buff;
			(me as any).fieldSedeMark[pick.pos] = 1;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: ${pick.cardId} recebeu +${buff} ATK até o fim do turno e comprará 1 carta ao derrotar um inimigo.` });
		});
		return;
	}

	if (effect === "aura_hp") {
		applyAuraHpBonusFromSource(state, slot, cardId, typeof context?.pos === "number" ? context.pos : undefined);
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: aura de vida ativa enquanto permanecer em campo.` });
		return;
	}

	if (effect === "search_deck_animal_aura_atk") {
		const searchDef = {
			...(cardDef as any),
			effect: "search_deck",
			query: { kind: "ally", tipo: "Animal" },
			max: 12,
			shuffleAfter: true,
			title: `${cardId}: escolha um aliado Animal do deck`
		} as CardDef;
		triggerAutoEffects(state, slot, cardId, searchDef, broadcast, askChoice, context);
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: seus aliados Animal recebem +1 de ataque enquanto permanecer em campo.` });
		return;
	}

	if (effect === "chamar_cidadao") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: habilidade será ativada quando esta carta for derrotada em combate.` });
		return;
	}

	if (effect === "aranhas_observadora") {
		const searchDef = { ...(cardDef as any), effect: "search_deck", shuffleAfter: true } as CardDef;
		triggerAutoEffects(state, slot, cardId, searchDef, broadcast, askChoice, context);
		return;
	}

	if (effect === "buff_on_kill") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: ganhará bônus ao derrotar inimigos em combate.` });
		return;
	}

	if (effect === "dmg_bonus") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: bônus de dano ativo enquanto o equipamento estiver em suporte.` });
		return;
	}

	if (effect === "draw_bonus") {
		const supportPos = typeof context?.pos === "number" ? context.pos : -1;
		if (supportPos < 0) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: equipamento em suporte sem posição válida para ativar.` });
			return;
		}
		const options: ChoiceOption[] = [];
		for (let index = 0; index < me.grave.length; index += 1) {
			const graveCardId = String(me.grave[index] || "");
			if (!graveCardId) continue;
			const graveDef = findCardDef(graveCardId);
			const graveKind = normalizeKind(String(graveDef?.kind || graveDef?.tipo || ""));
			if (graveKind !== "spell" && graveKind !== "magia") continue;
			options.push({ id: `orbe-${index}`, label: graveCardId, side: slot, lane: "grave", pos: index, cardId: graveCardId, description: `Deslocar ${graveCardId} do seu cemitério.` });
		}
		(me as any).supportCounters[supportPos] = 0;
		if (!options.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: não havia magias no seu cemitério para deslocar.` });
			return;
		}
		askChoice(slot, { title: `${cardId}: escolha quantas magias quiser para deslocar`, options, allowCancel: true, multiSelect: true, submitLabel: "Deslocar" }, (optionId) => {
			const selectedIds = String(optionId || "").split("|").map((value) => String(value || "").trim()).filter(Boolean);
			if (!selectedIds.length) {
				(me as any).supportCounters[supportPos] = 0;
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: não deslocou nenhuma magia do cemitério.` });
				return;
			}
			const picks = options.filter((option) => selectedIds.includes(String(option.id || "")) && typeof option.pos === "number");
			const sorted = picks.slice().sort((a, b) => Number(b.pos || 0) - Number(a.pos || 0));
			let displaced = 0;
			for (const pick of sorted) {
				if (typeof pick.pos !== "number") continue;
				const live = String(me.grave[pick.pos] || "");
				if (!live) continue;
				me.grave.splice(pick.pos, 1);
				(me as any).banished.push(live);
				displaced += 1;
			}
			(me as any).supportCounters[supportPos] = displaced;
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: deslocou ${displaced} magia(s) do cemitério e concedeu +${displaced} de bônus de ataque ao personagem equipado.` });
		});
		return;
	}

	if (effect === "redoma_santa") {
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < me.field.length; pos += 1) {
			const cid = String(me.field[pos] || "");
			if (!cid) continue;
			options.push({ id: `redoma-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!options.length) {
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: não havia aliado em campo para curar.` });
			return;
		}
		askChoice(slot, { title: `${cardId}: escolha um aliado em campo para curar`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) return;
			const currentHp = Number((me as any).fieldHp[pick.pos] || 0);
			const maxHp = getFieldMaxHp(state, slot, pick.pos);
			if (currentHp >= maxHp) {
				broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: ${pick.cardId} já estava com a vida cheia.` });
				return;
			}
			const healAmount = Math.min(3, Math.max(0, maxHp - currentHp));
			if (healAmount <= 0) return;
			(me as any).fieldHp[pick.pos] = currentHp + healAmount;
			triggerLeafaeOnAllyHeal(state, slot, broadcast, cardId);
			broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: curou ${healAmount} de vida de ${pick.cardId}.` });
		});
		return;
	}

	if (effect === "on_grave_damage_leader") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: causará dano ao líder inimigo quando este equipamento for ao cemitério.` });
		return;
	}

	if (effect === "leafae") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: marcadores acumulam automaticamente quando aliados são curados.` });
		return;
	}

	if (effect === "leafae_vital_guard") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: uma vez por turno, pode remover 3 marcadores de Elo Vital para curar 2 de vida de um aliado.` });
		return;
	}

	if (effect === "katsu") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: seus aliados Guerreiro podem atacar inimigos Dispostos.` });
		return;
	}

	if (effect === "katsu_warrior_burn") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: uma vez por turno, quando um aliado Guerreiro destruir um inimigo em combate, causa 2 de dano no Escolhido inimigo.` });
		return;
	}

	if (effect === "ademais_spider_mark") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: ganha 1 marcador Aranha sempre que um aliado \"Aranhas Negras\" for convocado.` });
		return;
	}

	if (effect === "ademais_spider_burst") {
		broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: pode remover 4 marcadores Aranha para causar 3 de dano ao Escolhido inimigo uma vez por turno.` });
		return;
	}

	broadcast("effect_log", { slot, cardId, effect, text: `${cardId}: efeito ainda não implementado no servidor.` });
}

function setPhase(state: MatchState, phase: TurnPhase, broadcast: (name: string, payload: any) => void) {
	const game = state.game;
	game.phase = phase;
	game.seq += 1;
	broadcast("phase_changed", { turn: game.turn, turnSlot: game.turnSlot, phase: game.phase, seq: game.seq });
}

export function finishMatch(state: MatchState, loser: Slot, reason: MatchEndReason, broadcast: (name: string, payload: any) => void): void {
	if (state.phase === "FINISHED") return;
	const winner = enemySlot(loser);
	state.phase = "FINISHED";
	state.game.seq += 1;
	broadcast("match_ended", {
		winner,
		loser,
		reason,
		p1Hp: state.game.p1.hp,
		p2Hp: state.game.p2.hp,
		seq: state.game.seq
	});
}

function handleDeckOutLoss(state: MatchState, loser: Slot, broadcast: (name: string, payload: any) => void): void {
	finishMatch(state, loser, "deckout", broadcast);
}

function debugDeckState(tag: string, slot: Slot, player: any): void {
	try {
		const deckCount = Array.from(player?.deck as Iterable<string> | undefined || []).length;
		const handCount = Array.from(player?.hand as Iterable<string> | undefined || []).length;
		console.log(`[deck-debug] ${tag} ${slot} deck=${deckCount} hand=${handCount}`);
	} catch {
		// no-op: debug logging must never affect gameplay
	}
}

function drawCard(state: MatchState, slot: Slot, amount: number = 1, broadcast?: (name: string, payload: any) => void): number {
	const pg = slot === "p1" ? state.game.p1 : state.game.p2;
	debugDeckState(`before-draw(${amount})`, slot, pg);
	let drawn = 0;
	for (let i = 0; i < amount; i++) {
		const top = pg.deck.length - 1;
		if (top < 0) break;
		const cardId = pg.deck[top];
		if (typeof cardId !== "string") break;
		removeDeckCardAt(pg, top);
		pg.hand.push(cardId);
		drawn += 1;
	}
	debugDeckState(`after-draw(${drawn}/${amount})`, slot, pg);
	if (drawn < amount && broadcast) {
		handleDeckOutLoss(state, slot, broadcast);
	}
	return drawn;
}

function startTurn(
	state: MatchState,
	slot: Slot,
	broadcast: (name: string, payload: any) => void,
	attackedThisTurn: Record<Slot, Set<number>>,
	summonedThisTurn: Record<Slot, Set<number>>,
	triggeredLeaderThisTurn: Record<Slot, Set<string>>,
	askChoice?: AskChoiceFn
) {
	const game = state.game;
	game.turnSlot = slot;
	(asPlayer(state, slot) as any).sedeVingancaTurn = 0;
	clearCatedralBlessing(state, slot, broadcast, askChoice);
	(asPlayer(state, slot) as any).leaderBlessing = 0;
	for (let index = 0; index < asPlayer(state, slot).field.length; index += 1) {
		(asPlayer(state, slot) as any).fieldBlessing[index] = 0;
	}
	attackedThisTurn[slot].clear();
	summonedThisTurn[slot].clear();
	triggeredLeaderThisTurn[slot].clear();
	const leaderFreeze = Number((asPlayer(state, slot) as any).leaderFrozen || 0);
	const leaderPinned = isLeaderPinned(state, slot);
	if (leaderFreeze > 0) {
		(asPlayer(state, slot) as any).leaderFrozen = Math.max(0, leaderFreeze - 1);
		(asPlayer(state, slot) as any).leaderTapped = true;
	} else if (leaderPinned) {
		(asPlayer(state, slot) as any).leaderTapped = true;
	} else {
		(asPlayer(state, slot) as any).leaderTapped = false;
	}
	for (let index = 0; index < asPlayer(state, slot).field.length; index += 1) {
		const freeze = Number((asPlayer(state, slot) as any).fieldFrozen[index] || 0);
		const pinned = isFieldPinned(state, slot, index);
		if (freeze > 0) {
			(asPlayer(state, slot) as any).fieldFrozen[index] = Math.max(0, freeze - 1);
			(asPlayer(state, slot) as any).fieldTapped[index] = true;
		} else if (pinned) {
			(asPlayer(state, slot) as any).fieldTapped[index] = true;
		} else {
			(asPlayer(state, slot) as any).fieldTapped[index] = false;
		}
		(asPlayer(state, slot) as any).fieldAtkTemp[index] = 0;
		(asPlayer(state, slot) as any).fieldSedeMark[index] = 0;
	}
	setPhase(state, "INITIAL", broadcast);

	const pg = slot === "p1" ? game.p1 : game.p2;
	const isOpeningTurnForStarter = slot === game.starterSlot && game.turn === 1 && (pg.fragmentMax || 0) <= 0;
	const add = isOpeningTurnForStarter ? 1 : 2;
	const envEffect = getPlayerEnvEffect(state, slot);
	pg.fragmentMax = Math.min(10, (pg.fragmentMax || 0) + add);
	pg.fragments = getEffectiveFragmentCap(state, slot);
	drawCard(state, slot, 1, broadcast);
	if (state.phase === "FINISHED") return;
	if (envEffect === "arcana_draw" && leaderHasFiliation(state, slot, "Arcana")) {
		drawCard(state, slot, 1, broadcast);
		if (state.phase === "FINISHED") return;
		broadcast("effect_log", { slot, cardId: String(asPlayer(state, slot).env || ""), effect: "arcana_draw", text: `Tempestade Arcana: compra extra no início do turno.` });
	}

	broadcast("turn_start", {
		turn: game.turn,
		turnSlot: game.turnSlot,
		starterSlot: game.starterSlot,
		phase: game.phase,
		add,
		p1Fragments: game.p1.fragments,
		p2Fragments: game.p2.fragments,
		p1Hand: game.p1.hand.length,
		p2Hand: game.p2.hand.length,
		p1Deck: game.p1.deck.length,
		p2Deck: game.p2.deck.length,
		seq: game.seq
	});
	offerCatedralBlessing(state, slot, broadcast, askChoice);
}

	export function initGame(state: MatchState, p1: any, p2: any, broadcast: (name: string, payload: any) => void, attacked: Record<Slot, Set<number>>, summoned: Record<Slot, Set<number>>, triggeredLeaderThisTurn: Record<Slot, Set<string>>, starterSlot: Slot = "p1", askChoice?: AskChoiceFn) {
	const game = state.game;
	game.p1.slot = "p1";
	game.p2.slot = "p2";
	game.starterSlot = starterSlot;
	game.p1.deckId = String(p1?.deckId || "");
	game.p2.deckId = String(p2?.deckId || "");
	game.p1.leaderId = String(p1?.leaderId || "");
	game.p2.leaderId = String(p2?.leaderId || "");
	game.p1.fragments = 0; game.p2.fragments = 0;
	game.p1.fragmentMax = 0; game.p2.fragmentMax = 0;
	game.p1.hp = Math.max(1, Number(findCardDef(game.p1.leaderId)?.hp || 30));
	game.p2.hp = Math.max(1, Number(findCardDef(game.p2.leaderId)?.hp || 30));
	(game.p1 as any).leaderTapped = false;
	(game.p2 as any).leaderTapped = false;
	(game.p1 as any).leaderFrozen = 0;
	(game.p2 as any).leaderFrozen = 0;
	(game.p1 as any).leaderPinnedUntilTurn = 0;
	(game.p2 as any).leaderPinnedUntilTurn = 0;
	(game.p1 as any).leaderBlessing = 0;
	(game.p2 as any).leaderBlessing = 0;
	(game.p1 as any).leaderVitalMarks = 0;
	(game.p2 as any).leaderVitalMarks = 0;
	(game.p1 as any).leaderSpiderMarks = 0;
	(game.p2 as any).leaderSpiderMarks = 0;
	game.p1.env = "";
	game.p2.env = "";
	game.p1.deck.clear(); game.p2.deck.clear();
	game.p1.hand.clear(); game.p2.hand.clear();
	game.p1.field.clear(); game.p2.field.clear();
	(game.p1 as any).fieldHp.clear(); (game.p2 as any).fieldHp.clear();
	(game.p1 as any).fieldTapped.clear(); (game.p2 as any).fieldTapped.clear();
	(game.p1 as any).fieldFrozen.clear(); (game.p2 as any).fieldFrozen.clear();
	(game.p1 as any).fieldPinnedUntilTurn.clear(); (game.p2 as any).fieldPinnedUntilTurn.clear();
	(game.p1 as any).fieldAtkTemp.clear(); (game.p2 as any).fieldAtkTemp.clear();
	(game.p1 as any).fieldAtkPerm.clear(); (game.p2 as any).fieldAtkPerm.clear();
	(game.p1 as any).fieldAcPerm.clear(); (game.p2 as any).fieldAcPerm.clear();
	(game.p1 as any).fieldSedeMark.clear(); (game.p2 as any).fieldSedeMark.clear();
	(game.p1 as any).fieldBloodMarks.clear(); (game.p2 as any).fieldBloodMarks.clear();
	(game.p1 as any).fieldBlessing.clear(); (game.p2 as any).fieldBlessing.clear();
	(game.p1 as any).fieldVitalMarks.clear(); (game.p2 as any).fieldVitalMarks.clear();
	game.p1.support.clear(); game.p2.support.clear();
	(game.p1 as any).supportAttachTo?.clear?.();
	(game.p1 as any).supportCounters?.clear?.();
	(game.p2 as any).supportAttachTo?.clear?.();
	(game.p2 as any).supportCounters?.clear?.();
	game.p1.grave.clear(); game.p2.grave.clear();
	(game.p1 as any).banished.clear(); (game.p2 as any).banished.clear();
	for (let index = 0; index < 5; index += 1) {
		game.p1.field.push("");
		game.p2.field.push("");
		(game.p1 as any).fieldHp.push(0);
		(game.p2 as any).fieldHp.push(0);
		(game.p1 as any).fieldTapped.push(false);
		(game.p2 as any).fieldTapped.push(false);
		(game.p1 as any).fieldFrozen.push(0);
		(game.p2 as any).fieldFrozen.push(0);
		(game.p1 as any).fieldPinnedUntilTurn.push(0);
		(game.p2 as any).fieldPinnedUntilTurn.push(0);
		(game.p1 as any).fieldAtkTemp.push(0);
		(game.p2 as any).fieldAtkTemp.push(0);
		(game.p1 as any).fieldAtkPerm.push(0);
		(game.p2 as any).fieldAtkPerm.push(0);
		(game.p1 as any).fieldAcPerm.push(0);
		(game.p2 as any).fieldAcPerm.push(0);
		(game.p1 as any).fieldSedeMark.push(0);
		(game.p2 as any).fieldSedeMark.push(0);
		(game.p1 as any).fieldBloodMarks.push(0);
		(game.p2 as any).fieldBloodMarks.push(0);
		(game.p1 as any).fieldBlessing.push(0);
		(game.p2 as any).fieldBlessing.push(0);
		(game.p1 as any).fieldVitalMarks.push(0);
		(game.p2 as any).fieldVitalMarks.push(0);
		game.p1.support.push("");
		game.p2.support.push("");
		(game.p1 as any).supportAttachTo.push(-2);
		(game.p2 as any).supportAttachTo.push(-2);
		(game.p1 as any).supportCounters.push(0);
		(game.p2 as any).supportCounters.push(0);
	}

	const d1 = Array.isArray(p1?.cards) && p1.cards.length ? [...p1.cards] : buildDeckFromId(game.p1.deckId);
	const d2 = Array.isArray(p2?.cards) && p2.cards.length ? [...p2.cards] : buildDeckFromId(game.p2.deckId);
	shuffle(d1); shuffle(d2);
	d1.forEach((c) => game.p1.deck.push(c));
	d2.forEach((c) => game.p2.deck.push(c));

	const p1Stack = [...game.p1.deck].filter((c): c is string => typeof c === "string");
	const p2Stack = [...game.p2.deck].filter((c): c is string => typeof c === "string");
	game.p1.deck.clear(); game.p2.deck.clear();
	drawToHand(p1Stack, game.p1.hand, 5);
	drawToHand(p2Stack, game.p2.hand, 5);
	p1Stack.forEach((c) => game.p1.deck.push(c));
	p2Stack.forEach((c) => game.p2.deck.push(c));

	game.turn = 1;
	game.seq = 0;
	startTurn(state, starterSlot, broadcast, attacked, summoned, triggeredLeaderThisTurn, askChoice);
}

export function getSlotBySession(state: MatchState, sessionId: string): Slot | null {
	const p = state.players.get(sessionId);
	if (!p) return null;
	return p.slot === "p1" || p.slot === "p2" ? (p.slot as Slot) : null;
}

export function nextPhase(state: MatchState, broadcast: (name: string, payload: any) => void) {
	if (state.game.phase === "INITIAL") return setPhase(state, "PREP", broadcast);
	if (state.game.phase === "PREP") return setPhase(state, "COMBAT", broadcast);
	if (state.game.phase === "COMBAT") return setPhase(state, "END", broadcast);
}

export function endTurn(
	state: MatchState,
	broadcast: (name: string, payload: any) => void,
	attacked: Record<Slot, Set<number>>,
	summoned: Record<Slot, Set<number>>,
	triggeredLeaderThisTurn: Record<Slot, Set<string>>,
	askChoice?: AskChoiceFn
) {
	state.game.turn += 1;
	const next: Slot = state.game.turnSlot === "p1" ? "p2" : "p1";
	startTurn(state, next, broadcast, attacked, summoned, triggeredLeaderThisTurn, askChoice);
}

export function playCard(state: MatchState, slot: Slot, cardId: string, targetPos: number | undefined, cardKind: string | undefined, broadcast: (name: string, payload: any) => void, summoned: Record<Slot, Set<number>>, triggeredLeaderThisTurn: Record<Slot, Set<string>>, askChoice: AskChoiceFn) {
	const game = state.game;
	const pg = slot === "p1" ? game.p1 : game.p2;
	const cardDef = findCardDef(cardId);
	const rawCardKind = String(cardKind || "");
	const forcedAgiotaMatch = rawCardKind.match(/__AGIOTA_(\d+)/);
	const forcedAgiotaPos = forcedAgiotaMatch ? Number(forcedAgiotaMatch[1]) : -1;
	const suppressAgiotaPrompt = rawCardKind.includes("__NO_AGIOTA");
	const sanitizedCardKind = rawCardKind.replace(/__AGIOTA_\d+/g, "").replace(/__NO_AGIOTA/g, "").trim();
	const idx = pg.hand.findIndex((c) => c === cardId);
	if (idx < 0) return;
	const cost = getCardCost(cardId);
	const actualKind = normalizeKind(String(cardDef?.kind || (cardDef as any)?.tipo || sanitizedCardKind || ""));
	const agiotaTurnKey = (pos: number) => `agiota:${pos}`;
	const payCardCost = (): boolean => {
		if (forcedAgiotaPos >= 0) {
			const liveAgiotaId = String(pg.field[forcedAgiotaPos] || "");
			if (!liveAgiotaId || String(findCardDef(liveAgiotaId)?.effect || "") !== "agiota") {
				broadcast("error", { text: "Agiota inválido para pagar este custo." });
				return false;
			}
			if (triggeredLeaderThisTurn[slot].has(agiotaTurnKey(forcedAgiotaPos))) {
				broadcast("error", { text: "Este Agiota já foi usado neste turno." });
				return false;
			}
			const agiotaHp = getTargetHP(state, slot, forcedAgiotaPos);
			if (agiotaHp <= 2) {
				broadcast("error", { text: "Vida insuficiente no Agiota para pagar este custo." });
				return false;
			}
			(pg as any).fieldHp[forcedAgiotaPos] = agiotaHp - 2;
			triggeredLeaderThisTurn[slot].add(agiotaTurnKey(forcedAgiotaPos));
			broadcast("effect_log", { slot, cardId: liveAgiotaId, effect: "agiota", text: `${liveAgiotaId}: sofreu 2 de dano para permitir jogar ${cardId} sem pagar fragmentos.` });
			return true;
		}
		if (Number(pg.fragments || 0) < cost) {
			broadcast("error", { text: "Fragmentos insuficientes." });
			return false;
		}
		pg.fragments -= cost;
		return true;
	};
	if (forcedAgiotaPos < 0 && !suppressAgiotaPrompt && cost <= 2) {
		const agiotaOptions: ChoiceOption[] = [];
		for (let pos = 0; pos < pg.field.length; pos += 1) {
			const allyId = String(pg.field[pos] || "");
			if (!allyId) continue;
			if (String(findCardDef(allyId)?.effect || "") !== "agiota") continue;
			if (triggeredLeaderThisTurn[slot].has(agiotaTurnKey(pos))) continue;
			if (getTargetHP(state, slot, pos) <= 2) continue;
			agiotaOptions.push({ id: `agiota-${pos}`, label: allyId, side: slot, lane: "field", pos, cardId: allyId, description: `Causar 2 de dano a ${allyId} para jogar ${cardId} sem pagar fragmentos.` });
		}
		if (agiotaOptions.length) {
			const options: ChoiceOption[] = [
				...agiotaOptions,
				{ id: "agiota-no", label: "Não usar", description: `Pagar o custo normal de ${cost} fragmento(s).` }
			];
			askChoice(slot, { title: `${cardId}: deseja usar Aranhas Negras, Agiota?`, options, allowCancel: true }, (optionId) => {
				if (!optionId || optionId === "agiota-no") {
					playCard(state, slot, cardId, targetPos, `${sanitizedCardKind} __NO_AGIOTA`.trim(), broadcast, summoned, triggeredLeaderThisTurn, askChoice);
					return;
				}
				const pick = agiotaOptions.find((option) => option.id === optionId);
				if (!pick || typeof pick.pos !== "number") {
					playCard(state, slot, cardId, targetPos, `${sanitizedCardKind} __NO_AGIOTA`.trim(), broadcast, summoned, triggeredLeaderThisTurn, askChoice);
					return;
				}
				playCard(state, slot, cardId, targetPos, `${sanitizedCardKind} __AGIOTA_${pick.pos}`.trim(), broadcast, summoned, triggeredLeaderThisTurn, askChoice);
			});
			return;
		}
	}
	if (forcedAgiotaPos < 0 && Number(pg.fragments || 0) < cost) {
		broadcast("error", { text: "Fragmentos insuficientes." });
		return;
	}
	if (String(cardDef?.effect || "") === "bem_treinado" && isSpellOrTrickKind(actualKind)) {
		broadcast("error", { text: `${cardId} é um truque reativo: ele ativa da mão quando um aliado seu vai ao cemitério.` });
		return;
	}
	if (String(cardDef?.effect || "") === "freeser" && isSpellOrTrickKind(actualKind)) {
		broadcast("error", { text: "Contrição é um truque reativo: ela ativa da mão quando um inimigo declara um ataque." });
		return;
	}
	const lane: "field" | "support" | "env" = isEnvKind(actualKind) ? "env" : (isAllyKind(actualKind) ? "field" : "support");
	const describeChoiceAction = (action: any): string => {
		const actionType = String(action?.type || "").trim();
		if (actionType === "heal") return `Cure ${Math.max(1, Number(action?.value || 1))} de vida de um personagem no seu campo.`;
		if (actionType === "draw") return `Compre ${Math.max(1, Number(action?.value || 1))} carta(s).`;
		if (actionType === "fragment_back") return `Recupere ${Math.max(1, Number(action?.value || 1))} fragmento(s).`;
		if (actionType === "tap_ally") return "Escolha um aliado para deitar.";
		if (actionType === "tap_enemy_ally") return "Escolha um aliado inimigo para exaurir.";
		if (actionType === "atk_temp") return `Escolha 1 aliado em campo: +${Math.max(1, Number(action?.value || 1))} ATK.`;
		if (actionType === "ban_on_enter") return "Escolha uma carta para deslocar.";
		if (actionType === "exhaust_martial_to_displace_ally") return "Exaura um aliado Marcial seu para deslocar 1 aliado inimigo.";
		if (actionType === "search_deck") return "Busque uma carta do deck conforme o filtro.";
		return "Aplicar efeito desta opção.";
	};
	const finishSpellToGrave = () => {
		if (state.phase === "FINISHED") return;
		pg.grave.push(cardId);
		game.seq += 1;
		broadcast("card_played", { slot, lane: "grave", cardId, cost, p1Fragments: game.p1.fragments, p2Fragments: game.p2.fragments, seq: game.seq });
	};
	const finishSpellResolved = () => {
		if (state.phase === "FINISHED") return;
		if (String((cardDef as any)?.resolveZone || "") === "banished") {
			(pg as any).banished.push(cardId);
			game.seq += 1;
			broadcast("card_played", { slot, lane: "banished", cardId, cost, p1Fragments: game.p1.fragments, p2Fragments: game.p2.fragments, seq: game.seq });
			return;
		}
		finishSpellToGrave();
	};
	const maybeTriggerValbrakFromCitizenSummon = (summonedCardId: string) => {
		const ownerLeaderId = asPlayer(state, slot).leaderId;
		if (!ownerLeaderId || triggeredLeaderThisTurn[slot].has(ownerLeaderId)) return;
		const leaderDef = findCardDef(ownerLeaderId);
		if (!cardHasEffectId(leaderDef, "valbrak")) return;
		drawCard(state, slot, 1, broadcast);
		if (state.phase === "FINISHED") return;
		triggeredLeaderThisTurn[slot].add(ownerLeaderId);
		broadcast("effect_log", { slot, cardId: ownerLeaderId, effect: "valbrak", text: `${ownerLeaderId}: Valbrak ativou e comprou 1 carta ao convocar ${summonedCardId}.` });
	};
	const maybeCounterSpellOrTrick = (onContinue: () => void, onCancelled: () => void) => {
		maybeOfferCounterToActivation(state, slot, cardId, broadcast, askChoice, onContinue, onCancelled);
	};
	const resolveChoiceAction = (action: any, done: () => void): void => {
		const actionType = String(action?.type || "").trim();
		if (actionType === "draw") {
			drawCard(state, slot, Math.max(1, Number(action?.value || 1)), broadcast);
			done();
			return;
		}
		if (actionType === "fragment_back") {
			pg.fragments = Math.min(getEffectiveFragmentCap(state, slot), Number(pg.fragments || 0) + Math.max(1, Number(action?.value || 1)));
			done();
			return;
		}
		if (actionType === "heal") {
			const options: ChoiceOption[] = [];
			if (String(pg.leaderId || "")) options.push({ id: "heal-leader", label: `Líder (${pg.leaderId})`, side: slot, lane: "env", cardId: String(pg.leaderId || "") });
			for (let pos = 0; pos < pg.field.length; pos += 1) {
				const cid = String(pg.field[pos] || "");
				if (!cid) continue;
				options.push({ id: `heal-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
			}
			if (!options.length) {
				done();
				return;
			}
			const healValue = Math.max(1, Number(action?.value || 1));
			askChoice(slot, { title: `${cardId}: escolha personagem para curar`, options, allowCancel: true }, (optionId) => {
				if (optionId === "heal-leader") {
					pg.hp = Math.min(getLeaderMaxHp(pg), Number(pg.hp || 0) + healValue);
					done();
					return;
				}
				const pick = options.find((o) => o.id === optionId);
				if (pick && typeof pick.pos === "number" && pick.cardId) {
					const current = getTargetHP(state, slot, pick.pos);
					const maxHp = getFieldMaxHp(state, slot, pick.pos);
					(pg as any).fieldHp[pick.pos] = Math.min(maxHp, current + healValue);
					triggerLeafaeOnAllyHeal(state, slot, broadcast, cardId);
				}
				done();
			});
			return;
		}
		if (actionType === "tap_ally") {
			const options: ChoiceOption[] = [];
			for (let pos = 0; pos < pg.field.length; pos += 1) {
				const cid = String(pg.field[pos] || "");
				if (!cid) continue;
				options.push({ id: `tap-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
			}
			if (!options.length) {
				done();
				return;
			}
			askChoice(slot, { title: `${cardId}: escolha aliado para deitar`, options, allowCancel: true }, (optionId) => {
				const pick = options.find((o) => o.id === optionId);
				if (pick && typeof pick.pos === "number") (pg as any).fieldTapped[pick.pos] = true;
				done();
			});
			return;
		}
		if (actionType === "tap_enemy_ally") {
			const foe = asPlayer(state, enemySlot(slot));
			const options: ChoiceOption[] = [];
			for (let pos = 0; pos < foe.field.length; pos += 1) {
				const cid = String(foe.field[pos] || "");
				if (!cid) continue;
				options.push({ id: `tap-enemy-${pos}`, label: cid, side: enemySlot(slot), lane: "field", pos, cardId: cid });
			}
			if (!options.length) {
				done();
				return;
			}
			askChoice(slot, { title: `${cardId}: escolha aliado inimigo para exaurir`, options, allowCancel: true }, (optionId) => {
				const pick = options.find((o) => o.id === optionId);
				if (pick && typeof pick.pos === "number") (foe as any).fieldTapped[pick.pos] = true;
				done();
			});
			return;
		}
		if (actionType === "atk_temp") {
			const foe = asPlayer(state, enemySlot(slot));
			const options: ChoiceOption[] = [];
			for (let pos = 0; pos < pg.field.length; pos += 1) {
				const cid = String(pg.field[pos] || "");
				if (!cid) continue;
				options.push({ id: `atk-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
			}
			for (let pos = 0; pos < foe.field.length; pos += 1) {
				const cid = String(foe.field[pos] || "");
				if (!cid) continue;
				options.push({ id: `atk-enemy-${pos}`, label: `${cid} (campo inimigo)`, side: enemySlot(slot), lane: "field", pos, cardId: cid });
			}
			if (!options.length) {
				done();
				return;
			}
			const buff = Math.max(1, Number(action?.value || 1));
			askChoice(slot, { title: `${cardId}: escolha personagem para receber +${buff} ATK`, options, allowCancel: true }, (optionId) => {
				const pick = options.find((o) => o.id === optionId);
				if (pick && typeof pick.pos === "number") {
					const owner = pick.side === enemySlot(slot) ? foe : pg;
					(owner as any).fieldAtkTemp[pick.pos] = Number((owner as any).fieldAtkTemp[pick.pos] || 0) + buff;
				}
				done();
			});
			return;
		}
		if (actionType === "ban_on_enter") {
			triggerAutoEffects(state, slot, cardId, { ...(cardDef as any), effect: "ban_on_enter" } as CardDef, broadcast, askChoice, { lane: "support" });
			done();
			return;
		}
		if (actionType === "exhaust_martial_to_displace_ally") {
			const other = asPlayer(state, enemySlot(slot));
			const ownOptions: ChoiceOption[] = [];
			for (let pos = 0; pos < pg.field.length; pos += 1) {
				const cid = String(pg.field[pos] || "");
				if (!cid) continue;
				if (isFieldTapped(pg as any, pos)) continue;
				if (!cardHasFiliation(cid, "Marcial")) continue;
				ownOptions.push({ id: `self-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
			}
			if (!ownOptions.length) {
				done();
				return;
			}
			const enemyChoices: ChoiceOption[] = [];
			for (let pos = 0; pos < other.field.length; pos += 1) {
				const cid = String(other.field[pos] || "");
				if (!cid) continue;
				enemyChoices.push({ id: `enemy-${pos}`, label: cid, side: enemySlot(slot), lane: "field", pos, cardId: cid });
			}
			if (!enemyChoices.length) {
				done();
				return;
			}
			askChoice(slot, { title: `${cardId}: escolha um aliado Marcial para exaurir`, options: ownOptions, allowCancel: true }, (ownOptionId) => {
				if (!ownOptionId) {
					done();
					return;
				}
				const ownPick = ownOptions.find((o) => o.id === ownOptionId);
				if (!ownPick || typeof ownPick.pos !== "number") {
					done();
					return;
				}
				const ownPos = ownPick.pos;
				const liveSelf = String(pg.field[ownPos] || "");
				if (!liveSelf || isFieldTapped(pg as any, ownPos) || !cardHasFiliation(liveSelf, "Marcial")) {
					done();
					return;
				}
				askChoice(slot, { title: `${cardId}: escolha um aliado inimigo para deslocar`, options: enemyChoices, allowCancel: true }, (enemyOptionId) => {
					if (!enemyOptionId) {
						done();
						return;
					}
					const enemyPick = enemyChoices.find((o) => o.id === enemyOptionId);
					if (!enemyPick || typeof enemyPick.pos !== "number") {
						done();
						return;
					}
					const enemyPos = enemyPick.pos;
					const liveEnemy = String(other.field[enemyPos] || "");
					if (!liveEnemy) {
						done();
						return;
					}
					(pg as any).fieldTapped[ownPos] = true;
					destroyAttachedSupports(state, enemySlot(slot), enemyPos, broadcast);
					const removed = clearFieldSlotWithAuras(state, enemySlot(slot), enemyPos) || liveEnemy;
					(other as any).banished.push(removed);
					broadcast("effect_log", { slot, cardId, effect: actionType, text: `${cardId}: exauriu ${liveSelf} para deslocar ${removed}.` });
					done();
				});
			});
			return;
		}
		if (actionType === "search_deck") {
			triggerAutoEffects(state, slot, cardId, { ...(cardDef as any), effect: "search_deck", query: action?.query, max: action?.max, shuffleAfter: action?.shuffleAfter } as CardDef, broadcast, askChoice, { lane: "support" });
			done();
			return;
		}
		done();
	};

	if ((cardDef as any)?.escolha1) {
		const effectA = (cardDef as any)?.effectA || null;
		const effectB = (cardDef as any)?.effectB || null;
		const options: ChoiceOption[] = [];
		if (effectA) options.push({ id: "choice-a", label: describeChoiceAction(effectA) });
		if (effectB) options.push({ id: "choice-b", label: describeChoiceAction(effectB) });
		if (!options.length) return;
		askChoice(slot, { title: `${cardId}: escolha um efeito`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const liveIdx = pg.hand.findIndex((c) => c === cardId);
			if (liveIdx < 0) return;
			const chosenAction = optionId === "choice-a" ? effectA : effectB;
			if (!payCardCost()) return;
			pg.hand.splice(liveIdx, 1);
			maybeCounterSpellOrTrick(
				() => resolveChoiceAction(chosenAction, () => finishSpellResolved()),
				() => finishSpellToGrave()
			);
		});
		return;
	}

	if (lane === "env") {
		if (!payCardCost()) return;
		pg.hand.splice(idx, 1);
		const previousEnv = String(pg.env || "");
		if (previousEnv) {
			if (String(findCardDef(previousEnv)?.effect || "") === "religioso_protecao") clearCatedralBlessing(state, slot, broadcast, askChoice);
			pg.grave.push(previousEnv);
		}
		pg.env = cardId;
		clampAllPlayersFragmentsToEffectiveCap(state);
		triggerAutoEffects(state, slot, cardId, cardDef, broadcast, askChoice, { lane: "env" });
		if (state.phase === "FINISHED") return;
		game.seq += 1;
		broadcast("card_played", { slot, lane: "env", cardId, cost, p1Fragments: game.p1.fragments, p2Fragments: game.p2.fragments, seq: game.seq });
		return;
	}

	if (isSpellOrTrickKind(actualKind) && !isEquipKind(actualKind)) {
		if (!payCardCost()) return;
		pg.hand.splice(idx, 1);
		maybeCounterSpellOrTrick(
			() => {
				triggerAutoEffects(state, slot, cardId, cardDef, broadcast, askChoice, { lane: "support" });
				if (String(cardDef?.effect || "") === "ajuda_do_povo") maybeTriggerValbrakFromCitizenSummon("Cidadãos Unidos");
				finishSpellResolved();
			},
			() => finishSpellToGrave()
		);
		return;
	}

	const targetLane = lane === "field" ? pg.field : pg.support;
	let finalPos = -1;
	if (typeof targetPos === "number" && targetPos >= 0 && targetPos < 5) {
		if (String(targetLane[targetPos] || "")) return void broadcast("error", { text: "Slot ocupado." });
		finalPos = targetPos;
	} else {
		for (let pos = 0; pos < 5; pos += 1) {
			if (!String(targetLane[pos] || "")) {
				finalPos = pos;
				break;
			}
		}
	}
	if (finalPos < 0) return void broadcast("error", { text: lane === "field" ? "Campo de aliados cheio." : "Linha de suporte cheia." });
	if (lane === "support" && isEquipKind(actualKind)) {
		const options: ChoiceOption[] = [];
		if (String(pg.leaderId || "")) options.push({ id: "equip-leader", label: `Líder (${pg.leaderId})`, side: slot, lane: "env", cardId: String(pg.leaderId || "") });
		for (let pos = 0; pos < pg.field.length; pos += 1) {
			const cid = String(pg.field[pos] || "");
			if (!cid) continue;
			options.push({ id: `equip-ally-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid });
		}
		if (!options.length) return void broadcast("error", { text: "Sem alvo válido no seu campo para equipar." });
		askChoice(slot, { title: `${cardId}: escolha aliado ou líder para equipar`, options, allowCancel: true }, (optionId) => {
			if (!optionId) return;
			const liveIdx = pg.hand.findIndex((c) => c === cardId);
			if (liveIdx < 0) return;
			const pick = options.find((o) => o.id === optionId);
			if (!pick) return;
			if (!payCardCost()) return;
			pg.hand.splice(liveIdx, 1);
			pg.support[finalPos] = cardId;
			(pg as any).supportAttachTo[finalPos] = optionId === "equip-leader" ? -1 : Number(pick.pos ?? -2);
			(pg as any).supportCounters[finalPos] = 0;
			const hpBonus = Number((cardDef as any)?.hpBonus || 0);
			if (hpBonus > 0) {
				if (optionId === "equip-leader") pg.hp = Number(pg.hp || 0) + hpBonus;
				else if (typeof pick.pos === "number") (pg as any).fieldHp[pick.pos] = Number((pg as any).fieldHp[pick.pos] || 0) + hpBonus;
			}
			triggerAutoEffects(state, slot, cardId, cardDef, broadcast, askChoice, { lane, pos: finalPos });
			if (state.phase === "FINISHED") return;
			game.seq += 1;
			broadcast("card_played", { slot, lane, cardId, targetPos: finalPos, cost, p1Fragments: game.p1.fragments, p2Fragments: game.p2.fragments, seq: game.seq });
		});
		return;
	}
	if (!payCardCost()) return;
	pg.hand.splice(idx, 1);
	if (lane === "field") {
		placeAllyOnField(state, slot, pg as any, cardId, finalPos, broadcast, askChoice);
	} else {
		targetLane[finalPos] = cardId;
	}
	if (lane === "support") {
		(pg as any).supportAttachTo[finalPos] = -2;
		(pg as any).supportCounters[finalPos] = 0;
	}
	if (lane === "field") summoned[slot].add(finalPos);
	if (lane !== "field") triggerAutoEffects(state, slot, cardId, cardDef, broadcast, askChoice, { lane, pos: finalPos });
	if (state.phase === "FINISHED") return;

	// Leader triggers: Valbrak — once per turn, when a "Cidadão" ally is summoned, draw a card
	try {
		const summonedDef = cardDef || findCardDef(cardId);
		const summonedClasse = String(((summonedDef as any)?.classe || (summonedDef as any)?.class || ""));
		const isCitizen = normalizeKind(summonedClasse) === "cidadao";
		const isBlackSpiders = cardNameIncludes(cardId, "Aranhas Negras");
		if (lane === "field" && isCitizen) {
			const ownerLeaderId = asPlayer(state, slot).leaderId;
			const owner = asPlayer(state, slot) as any;
			const valbrakTurnKey = leaderEffectTurnKey(owner, "valbrak");
			if (ownerLeaderId && !triggeredLeaderThisTurn[slot].has(valbrakTurnKey)) {
				const leaderDef = findCardDef(ownerLeaderId);
				if (cardHasEffectId(leaderDef, "valbrak")) {
					drawCard(state, slot, 1, broadcast);
					if (state.phase === "FINISHED") return;
					triggeredLeaderThisTurn[slot].add(valbrakTurnKey);
					broadcast("effect_log", { slot, cardId: ownerLeaderId, effect: "valbrak", text: `${ownerLeaderId}: Valbrak ativou e comprou 1 carta ao convocar ${cardId}.` });
				}
			}
		}
		if (lane === "field" && isBlackSpiders) {
			awardAdemaisSpiderMarkOnSummon(state, slot, cardId, broadcast);
		}
	} catch (e) {
		// swallow errors to avoid breaking core play flow
	}
	game.seq += 1;
	broadcast("card_played", { slot, lane, cardId, targetPos: finalPos, cost, p1Fragments: game.p1.fragments, p2Fragments: game.p2.fragments, seq: game.seq });
}

export function activateLeaderPower(
	state: MatchState,
	slot: Slot,
	broadcast: (name: string, payload: any) => void,
	askChoice?: AskChoiceFn
) {
	if (state.phase === "FINISHED") return false;
	if (state.game.turnSlot !== slot) return false;
	if (state.game.phase !== "PREP") return false;
	const player = asPlayer(state, slot) as any;
	if (!player || player.leaderTapped) return false;
	const leaderId = String(player.leaderId || "");
	if (!leaderId) return false;
	const leaderDef = findCardDef(leaderId);
	if (cardHasEffectId(leaderDef, "valbrak_citizen_boost")) {
		if (Number(player.fragments || 0) < 2) return false;
		const citizenPositions: number[] = [];
		for (let pos = 0; pos < player.field.length; pos += 1) {
			const cid = String(player.field[pos] || "");
			if (!cid || !cardHasClasse(cid, "Cidadao")) continue;
			citizenPositions.push(pos);
		}
		if (!citizenPositions.length) return false;
		player.fragments = Math.max(0, Number(player.fragments || 0) - 2);
		player.leaderTapped = true;
		for (const pos of citizenPositions) {
			player.fieldAtkTemp[pos] = Number(player.fieldAtkTemp[pos] || 0) + 1;
		}
		state.game.seq += 1;
		broadcast("effect_log", {
			slot,
			cardId: leaderId,
			effect: "valbrak_citizen_boost",
			text: `${leaderId}: pagou 2 fragmentos e seus aliados Cidadão receberam +1 ATK até o fim do turno.`
		});
		return true;
	}
	if (cardHasEffectId(leaderDef, "ademais_spider_burst")) {
		const spiderMarks = Number(player.leaderSpiderMarks || 0);
		if (spiderMarks < 4) return false;
		const foeSlot = enemySlot(slot);
		const foe = asPlayer(state, foeSlot) as any;
		player.leaderSpiderMarks = spiderMarks - 4;
		player.leaderTapped = true;
		applyDamageToLeader(foe, 3);
		state.game.seq += 1;
		broadcast("effect_log", {
			slot,
			cardId: leaderId,
			effect: "ademais_spider_burst",
			text: `${leaderId}: removeu 4 marcadores Aranha e causou 3 de dano no Escolhido inimigo.`
		});
		if (foe.hp <= 0) finishMatch(state, foeSlot, "hp_zero", broadcast);
		return true;
	}
	if (cardHasEffectId(leaderDef, "leafae_vital_guard")) {
		if (!askChoice) return false;
		const vitalMarks = Number(player.leaderVitalMarks || 0);
		if (vitalMarks < 3) return false;
		const options: ChoiceOption[] = [];
		for (let pos = 0; pos < player.field.length; pos += 1) {
			const cid = String(player.field[pos] || "");
			if (!cid) continue;
			const currentHp = Number(player.fieldHp[pos] || 0);
			const maxHp = getFieldMaxHp(state, slot, pos);
			if (currentHp >= maxHp) continue;
			options.push({ id: `leafae-heal-${pos}`, label: cid, side: slot, lane: "field", pos, cardId: cid, description: "Cura 2 de vida." });
		}
		if (!options.length) return false;
		player.leaderTapped = true;
		askChoice(slot, { title: `${leaderId}: escolha um aliado para curar 2 de vida`, options, allowCancel: true }, (optionId) => {
			if (!optionId) {
				player.leaderTapped = false;
				return;
			}
			const pick = options.find((option) => option.id === optionId);
			if (!pick || typeof pick.pos !== "number" || !pick.cardId) {
				player.leaderTapped = false;
				return;
			}
			const liveCardId = String(player.field[pick.pos] || "");
			if (!liveCardId || liveCardId !== pick.cardId) {
				player.leaderTapped = false;
				return;
			}
			const currentHp = Number(player.fieldHp[pick.pos] || 0);
			const maxHp = getFieldMaxHp(state, slot, pick.pos);
			const healAmount = Math.min(2, Math.max(0, maxHp - currentHp));
			if (healAmount <= 0) {
				player.leaderTapped = false;
				return;
			}
			player.leaderVitalMarks = Math.max(0, Number(player.leaderVitalMarks || 0) - 3);
			player.fieldHp[pick.pos] = currentHp + healAmount;
			triggerLeafaeOnAllyHeal(state, slot, broadcast, leaderId);
			state.game.seq += 1;
			broadcast("effect_log", {
				slot,
				cardId: leaderId,
				effect: "leafae_vital_guard",
				text: `${leaderId}: removeu 3 marcadores de Elo Vital e curou ${healAmount} de vida de ${pick.cardId}.`
			});
		});
		return true;
	}
	return false;
}

export function attack(
	state: MatchState,
	slot: Slot,
	attackerPos: number,
	target: AttackTarget,
	broadcast: (name: string, payload: any) => void,
	attacked: Record<Slot, Set<number>>,
	summoned: Record<Slot, Set<number>>,
	triggeredLeaderThisTurn: Record<Slot, Set<string>>,
	askChoice: AskChoiceFn
) {
	const game = state.game;
	if (!canAttackServer(state, slot, attackerPos, attacked, summoned)) return;
	const me = slot === "p1" ? game.p1 : game.p2;
	const enemySlot: Slot = slot === "p1" ? "p2" : "p1";
	const enemy = enemySlot === "p1" ? game.p1 : game.p2;
	const isLeaderAttacker = attackerPos < 0;
	const attackerId = isLeaderAttacker ? String(me.leaderId || "") : String(me.field[attackerPos] || "");
	if (!attackerId) return;
	const attackerDef = findCardDef(attackerId);
	const katsuWarrior = !isLeaderAttacker && hasKatsuWarriorException(state, slot, attackerId);

	const enemyTauntTapped = Array.from({ length: enemy.field.length }, (_, index) => {
		const cid = String(enemy.field[index] || "");
		if (!cid) return false;
		if (!isFieldTapped(enemy as any, index)) return false;
		const def = findCardDef(cid);
		return cardHasKeyword(def, "provocar");
	});
	const hasTauntTapped = enemyTauntTapped.some(Boolean);

	let finalTarget: AttackTarget = target;

	function resolveAfterBlock(finalTargetLocal: AttackTarget) {
		attacked[slot].add(attackerPos);
		if (isLeaderAttacker) {
			(me as any).leaderTapped = true;
		} else {
			(me as any).fieldTapped[attackerPos] = true;
		}
		const attackValue = getCombatAttackValue(state, slot, attackerId, attackerPos, reactiveAttackPenalty);
		const targetResistance = getTargetResistance(state, enemySlot, finalTargetLocal);
		const diffToResistance = attackValue - targetResistance;
		const tieDealsMinimumDamage = diffToResistance === 0;
		const hit = diffToResistance >= 0;

		let damage = hit ? Math.max(1, diffToResistance) : 0;
		let targetCardId: string | null = null;
		let killedTargetAlly = false;
		if (finalTargetLocal.type === "ally") {
			ensureFieldSlots(enemy.field as any);
			const enemyCard = enemy.field[finalTargetLocal.targetPos];
			if (typeof enemyCard !== "string" || !enemyCard) return;
			const enemyCardHp = getTargetHP(state, enemySlot, finalTargetLocal.targetPos);
			targetCardId = enemyCard;
			let reduction = getDamageReduction(enemyCard);
			if (reduction > 0) damage = Math.max(0, damage - reduction);
			else if (hasProtected(enemyCard)) damage = Math.max(0, damage - 1);
			if (tieDealsMinimumDamage) damage = Math.max(1, damage);
			const remainingHp = Math.max(0, enemyCardHp - damage);
			(enemy as any).fieldHp[finalTargetLocal.targetPos] = remainingHp;
			if (remainingHp <= 0) {
				destroyAttachedSupports(state, enemySlot, finalTargetLocal.targetPos, broadcast);
				const removed = clearFieldSlotWithAuras(state, enemySlot, finalTargetLocal.targetPos);
				if (removed) {
					enemy.grave.push(removed);
						handleDestroyedAllyTriggers(state, enemySlot, removed, broadcast, askChoice, { fromCombat: true });
					killedTargetAlly = true;
				}
			}
			const attackerHasTrample = cardHasKeyword(attackerDef, "atropelar");
			const overflow = attackerHasTrample && remainingHp <= 0 ? Math.max(0, damage - enemyCardHp) : 0;
			if (overflow > 0) {
				applyDamageToLeader(enemy, overflow, true);
				broadcast("effect_log", { slot, cardId: attackerId, effect: "atropelar", text: `${attackerId}: causou ${overflow} de excesso no líder.` });
			}
		} else {
			damage = applyDamageToLeader(enemy, damage, true);
		}

		if (!isLeaderAttacker && killedTargetAlly) {
			if (String(attackerDef?.effect || "") === "buff_on_kill") {
				(me as any).fieldAtkPerm[attackerPos] = Number((me as any).fieldAtkPerm[attackerPos] || 0) + 1;
				(me as any).fieldAcPerm[attackerPos] = Number((me as any).fieldAcPerm[attackerPos] || 0) + 1;
				(me as any).fieldBloodMarks[attackerPos] = Number((me as any).fieldBloodMarks[attackerPos] || 0) + 1;
				broadcast("effect_log", { slot, cardId: attackerId, effect: "buff_on_kill", text: `${attackerId}: ganhou 1 marcador de sangue, +1 ATK e +1 AC por derrotar um inimigo.` });
			}
			if (Number((me as any).fieldSedeMark[attackerPos] || 0) > 0) {
				drawCard(state, slot, 1, broadcast);
				if (state.phase !== "FINISHED") {
					tryUntapField(state, slot, attackerPos);
					(me as any).fieldSedeMark[attackerPos] = 0;
					broadcast("effect_log", { slot, cardId: attackerId, effect: "sede_vinganca", text: `${attackerId}: derrotou inimigo, comprou 1 carta e ficou disposto.` });
				}
			}
			const katsuBurnKey = leaderEffectTurnKey(me, "katsu_warrior_burn");
			if (!triggeredLeaderThisTurn[slot].has(katsuBurnKey) && leaderHasEffect(me, "katsu_warrior_burn") && cardHasClasse(attackerId, "Guerreiro")) {
				applyDamageToLeader(enemy, 2);
				triggeredLeaderThisTurn[slot].add(katsuBurnKey);
				broadcast("effect_log", { slot, cardId: String(me.leaderId || ""), effect: "katsu_warrior_burn", text: `${String(me.leaderId || "Katsu")}: um aliado Guerreiro destruiu um inimigo em combate e causou 2 de dano no Escolhido inimigo.` });
			}
		}
		const targetName = finalTargetLocal.type === "leader" ? asPlayer(state, enemySlot).leaderId : (targetCardId || String(asPlayer(state, enemySlot).field[finalTargetLocal.targetPos] || "Aliado"));

		game.seq += 1;
		broadcast("attack_resolved", {
			attackerSlot: slot, attackerPos, attackerLeader: isLeaderAttacker, attackerId, target: finalTargetLocal.type,
			targetPos: finalTargetLocal.type === "ally" ? finalTargetLocal.targetPos : undefined,
			targetCardId, damage, hit, attackValue, targetResistance, diffToResistance,
			totalRoll: attackValue, targetAC: targetResistance, diffToCA: diffToResistance,
			attackerName: attackerDef?.name || attackerId,
			targetName,
			p1Hp: game.p1.hp, p2Hp: game.p2.hp, seq: game.seq
		});
		if (enemy.hp <= 0) {
			state.phase = "FINISHED";
			broadcast("match_ended", { winner: slot, loser: enemySlot, p1Hp: game.p1.hp, p2Hp: game.p2.hp, seq: game.seq });
		}
	}
	let reactiveAttackPenalty = 0;
	const continueDeclaredAttack = () => {
		if (target.type === "ally") {
			if (!Number.isInteger(target.targetPos) || target.targetPos < 0 || target.targetPos >= enemy.field.length) return;
			const targetCard = String(enemy.field[target.targetPos] || "");
			if (!targetCard) return;
			if (hasTauntTapped && !enemyTauntTapped[target.targetPos]) return;
			if (!katsuWarrior && !isFieldTapped(enemy as any, target.targetPos)) return;
		} else if (hasTauntTapped) {
		}

		if (!hasTauntTapped && (finalTarget.type === "leader" || finalTarget.type === "ally")) {
			const blockers: number[] = [];
			for (let index = 0; index < enemy.field.length; index += 1) {
				const cid = String(enemy.field[index] || "");
				if (!cid) continue;
				if (isFieldTapped(enemy as any, index)) continue;
				if (getTargetHP(state, enemySlot, index) <= 0) continue;
				if (finalTarget.type === "ally" && index === finalTarget.targetPos) continue;
				const def = findCardDef(cid);
				if (cardHasKeyword(def, "bloquear")) blockers.push(index);
			}
			if (blockers.length) {
				const attackValue = getCombatAttackValue(state, slot, attackerId, attackerPos, reactiveAttackPenalty);
				const targetCardId = finalTarget.type === "ally" ? String(enemy.field[finalTarget.targetPos] || "") : String(enemy.leaderId || "");
				const targetName = finalTarget.type === "ally" ? targetCardId || "Aliado" : String(enemy.leaderId || "Líder");
				const targetResistance = getTargetResistance(state, enemySlot, finalTarget);
				const targetHp = finalTarget.type === "ally"
					? getTargetHP(state, enemySlot, finalTarget.targetPos)
					: Number(enemy.hp || 0);
				const targetMaxHp = finalTarget.type === "ally"
					? getCardDynamicMaxHp(state, enemySlot, finalTarget.targetPos, targetCardId)
					: Math.max(1, getCardMaxHp(String(enemy.leaderId || "")) + getAttachedSupportNumericBonus(enemy, null, "hpBonus") + getLeaderBlessing(state, enemySlot));
				const options: ChoiceOption[] = blockers.map((pos) => ({ id: `block-${pos}`, label: String(enemy.field[pos] || ""), side: enemySlot, lane: "field", pos, cardId: String(enemy.field[pos] || "") }));
				options.push({ id: `block-cancel`, label: "Não interpor", side: enemySlot });
				askChoice(enemySlot, {
					title: `${String(enemySlot)}: escolher aliado para interpor?`,
					options,
					allowCancel: true,
					attackerId,
					attackerName: attackerDef?.name || attackerId,
					attackerAttack: attackValue,
					targetCardId,
					targetName,
					targetResistance,
					targetHp,
					targetMaxHp
				}, (optionId) => {
					let chosenPos: number | null = null;
					if (optionId && optionId.startsWith("block-")) {
						const parts = optionId.split("-");
						if (parts.length === 2) chosenPos = Number(parts[1]);
					}
					if (chosenPos != null && !Number.isNaN(chosenPos)) {
						if (isFieldTapped(enemy as any, chosenPos)) {
							resolveAfterBlock(finalTarget);
							return;
						}
						if (getTargetHP(state, enemySlot, chosenPos) <= 0) {
							resolveAfterBlock(finalTarget);
							return;
						}
						if (finalTarget.type === "ally" && chosenPos === finalTarget.targetPos) {
							resolveAfterBlock(finalTarget);
							return;
						}
						(enemy as any).fieldTapped[chosenPos] = true;
						finalTarget = { type: "ally", targetPos: chosenPos };
						broadcast("effect_log", { slot: enemySlot, cardId: String(enemy.field[chosenPos] || ""), effect: "bloquear", text: `${enemySlot}: interpôs no ataque.` });
					}
					resolveAfterBlock(finalTarget);
				});
				return;
			}
		}

		attacked[slot].add(attackerPos);
		if (isLeaderAttacker) {
			(me as any).leaderTapped = true;
		} else {
			(me as any).fieldTapped[attackerPos] = true;
		}
		let attackValue = getAttackBonus(attackerId) + reactiveAttackPenalty + getAuraAttackBonus(state, slot, attackerId);
		if (isLeaderAttacker) {
			attackValue += getLeaderAttackBonus(me as any);
			attackValue += getAttachedSupportNumericBonus(me as any, null, "atkBonus");
			attackValue += getLeaderDamageBonus(me as any);
		} else {
			attackValue += Number((me as any).fieldAtkTemp[attackerPos] || 0);
			attackValue += getFieldAttackPermBonus(me as any, attackerPos);
			attackValue += getAttachedSupportNumericBonus(me as any, attackerPos, "atkBonus");
			attackValue += getFieldDamageBonusFromVital(me as any, attackerPos);
		}
		if (!isLeaderAttacker && String(attackerDef?.effect || "") === "kornex_buff_per_marcial_in_play") {
			let marcialCount = 0;
			for (const s of [slot, enemySlot] as Slot[]) {
				const p = asPlayer(state, s);
				const leaderId = String(p.leaderId || "");
				if (leaderId && cardHasFiliation(leaderId, "Marcial")) marcialCount += 1;
				for (let index = 0; index < p.field.length; index += 1) {
					const cid = String(p.field[index] || "");
					if (cid && cardHasFiliation(cid, "Marcial")) marcialCount += 1;
				}
				for (let index = 0; index < p.support.length; index += 1) {
					const cid = String(p.support[index] || "");
					if (cid && cardHasFiliation(cid, "Marcial")) marcialCount += 1;
				}
				const envId = String(p.env || "");
				if (envId && cardHasFiliation(envId, "Marcial")) marcialCount += 1;
			}
			attackValue += Math.max(0, marcialCount - 1);
		}
		if (hasMarcialEnvAttackBonus(state, slot, attackerId)) attackValue += 1;
		attackValue += getAttachedSupportCounter(me as any, "draw_bonus", isLeaderAttacker ? null : attackerPos);
		attackValue += getAttachedSupportNumericBonus(me as any, isLeaderAttacker ? null : attackerPos, "dmgBonus");
		const targetResistance = getTargetResistance(state, enemySlot, finalTarget);
		const diffToResistance = attackValue - targetResistance;
		const tieDealsMinimumDamage = diffToResistance === 0;
		const hit = diffToResistance >= 0;

		let damage = hit ? Math.max(1, diffToResistance) : 0;
		let targetCardId: string | null = null;
		let killedTargetAlly = false;
		if (finalTarget.type === "ally") {
			ensureFieldSlots(enemy.field as any);
			const enemyCard = enemy.field[finalTarget.targetPos];
			if (typeof enemyCard !== "string" || !enemyCard) return;
			const enemyCardHp = getTargetHP(state, enemySlot, finalTarget.targetPos);
			targetCardId = enemyCard;
			let reduction = getDamageReduction(enemyCard);
			if (reduction > 0) damage = Math.max(0, damage - reduction);
			else if (hasProtected(enemyCard)) damage = Math.max(0, damage - 1);
			if (tieDealsMinimumDamage) damage = Math.max(1, damage);
			const remainingHp = Math.max(0, enemyCardHp - damage);
			(enemy as any).fieldHp[finalTarget.targetPos] = remainingHp;
			if (remainingHp <= 0) {
				destroyAttachedSupports(state, enemySlot, finalTarget.targetPos, broadcast);
				const removed = clearFieldSlotWithAuras(state, enemySlot, finalTarget.targetPos);
				if (removed) {
					enemy.grave.push(removed);
						handleDestroyedAllyTriggers(state, enemySlot, removed, broadcast, askChoice, { fromCombat: true });
					killedTargetAlly = true;
				}
			}
			const attackerHasTrample = cardHasKeyword(attackerDef, "atropelar");
			const overflow = attackerHasTrample && remainingHp <= 0 ? Math.max(0, damage - enemyCardHp) : 0;
			if (overflow > 0) {
				applyDamageToLeader(enemy, overflow, true);
				broadcast("effect_log", { slot, cardId: attackerId, effect: "atropelar", text: `${attackerId}: causou ${overflow} de excesso no líder.` });
			}
		} else {
			damage = applyDamageToLeader(enemy, damage, true);
		}

		if (!isLeaderAttacker && killedTargetAlly) {
			if (String(attackerDef?.effect || "") === "buff_on_kill") {
				(me as any).fieldAtkPerm[attackerPos] = Number((me as any).fieldAtkPerm[attackerPos] || 0) + 1;
				(me as any).fieldAcPerm[attackerPos] = Number((me as any).fieldAcPerm[attackerPos] || 0) + 1;
				(me as any).fieldBloodMarks[attackerPos] = Number((me as any).fieldBloodMarks[attackerPos] || 0) + 1;
				broadcast("effect_log", { slot, cardId: attackerId, effect: "buff_on_kill", text: `${attackerId}: ganhou 1 marcador de sangue, +1 ATK e +1 AC por derrotar um inimigo.` });
			}
			if (Number((me as any).fieldSedeMark[attackerPos] || 0) > 0) {
				drawCard(state, slot, 1, broadcast);
				if (state.phase !== "FINISHED") {
					tryUntapField(state, slot, attackerPos);
					(me as any).fieldSedeMark[attackerPos] = 0;
					broadcast("effect_log", { slot, cardId: attackerId, effect: "sede_vinganca", text: `${attackerId}: derrotou inimigo, comprou 1 carta e ficou disposto.` });
				}
			}
			const katsuBurnKey = leaderEffectTurnKey(me, "katsu_warrior_burn");
			if (!triggeredLeaderThisTurn[slot].has(katsuBurnKey) && leaderHasEffect(me, "katsu_warrior_burn") && cardHasClasse(attackerId, "Guerreiro")) {
				applyDamageToLeader(enemy, 2);
				triggeredLeaderThisTurn[slot].add(katsuBurnKey);
				broadcast("effect_log", { slot, cardId: String(me.leaderId || ""), effect: "katsu_warrior_burn", text: `${String(me.leaderId || "Katsu")}: um aliado Guerreiro destruiu um inimigo em combate e causou 2 de dano no Escolhido inimigo.` });
			}
		}
		const targetName = finalTarget.type === "leader" ? asPlayer(state, enemySlot).leaderId : (targetCardId || String(asPlayer(state, enemySlot).field[finalTarget.targetPos] || "Aliado"));

		game.seq += 1;
		broadcast("attack_resolved", {
			attackerSlot: slot, attackerPos, attackerLeader: isLeaderAttacker, attackerId, target: finalTarget.type,
			targetPos: finalTarget.type === "ally" ? finalTarget.targetPos : undefined,
			targetCardId, damage, hit, attackValue, targetResistance, diffToResistance,
			totalRoll: attackValue, targetAC: targetResistance, diffToCA: diffToResistance,
			attackerName: attackerDef?.name || attackerId,
			targetName,
			p1Hp: game.p1.hp, p2Hp: game.p2.hp, seq: game.seq
		});
		if (enemy.hp <= 0) {
			state.phase = "FINISHED";
			broadcast("match_ended", { winner: slot, loser: enemySlot, p1Hp: game.p1.hp, p2Hp: game.p2.hp, seq: game.seq });
		}
	};

	const offerEmboscadaReaction = () => {
		const attackValueForReaction = getCombatAttackValue(state, slot, attackerId, attackerPos, reactiveAttackPenalty);
		const declaredTargetCardId = target.type === "ally"
			? String(enemy.field[target.targetPos] || "")
			: String(enemy.leaderId || "");
		const declaredTargetName = target.type === "ally"
			? (declaredTargetCardId || "Aliado")
			: String(enemy.leaderId || "Líder");
		const declaredTargetResistance = getTargetResistance(state, enemySlot, target);
		const declaredTargetHp = target.type === "ally"
			? getTargetHP(state, enemySlot, target.targetPos)
			: Number(enemy.hp || 0);
		const declaredTargetMaxHp = target.type === "ally"
			? getCardDynamicMaxHp(state, enemySlot, target.targetPos, declaredTargetCardId)
			: Math.max(1, getCardMaxHp(String(enemy.leaderId || "")) + getAttachedSupportNumericBonus(enemy, null, "hpBonus") + getLeaderBlessing(state, enemySlot));
		const emboscadaIndex = enemy.hand.findIndex((cid: string) => String(findCardDef(String(cid || ""))?.effect || "") === "aranhas_emboscada");
		if (emboscadaIndex >= 0) {
			const emboscadaCardId = String(enemy.hand[emboscadaIndex] || "");
			const emboscadaCost = getCardCost(emboscadaCardId);
			if (emboscadaCardId && Number(enemy.fragments || 0) >= emboscadaCost) {
				const options: ChoiceOption[] = [
					{ id: "emboscada-yes", label: `Ativar ${emboscadaCardId}`, description: `Pagar ${emboscadaCost} fragmento(s) para dar -1 ATK ao atacante.` },
					{ id: "emboscada-no", label: "Não ativar" }
				];
				askChoice(enemySlot, {
					title: `${emboscadaCardId}: deseja ativar contra ${attackerId}?`,
					options,
					allowCancel: true,
					attackerId,
					attackerName: attackerDef?.name || attackerId,
					attackerAttack: attackValueForReaction,
					targetCardId: declaredTargetCardId,
					targetName: declaredTargetName,
					targetResistance: declaredTargetResistance,
					targetHp: declaredTargetHp,
					targetMaxHp: declaredTargetMaxHp
				}, (optionId) => {
					if (optionId === "emboscada-yes") {
						const liveEmboscadaIndex = enemy.hand.findIndex((cid: string) => String(cid || "") === emboscadaCardId);
						if (liveEmboscadaIndex >= 0 && Number(enemy.fragments || 0) >= emboscadaCost) {
							enemy.fragments -= emboscadaCost;
							enemy.hand.splice(liveEmboscadaIndex, 1);
							enemy.grave.push(emboscadaCardId);
							maybeOfferCounterToActivation(state, enemySlot, emboscadaCardId, broadcast, askChoice, () => {
								reactiveAttackPenalty -= 1;
								const hasAranhas = Array.from({ length: enemy.field.length }, (_, index) => String(enemy.field[index] || "")).some((cid) => normalizeLoose(String(findCardDef(cid)?.name || cid || "")).includes("aranhasnegras"));
								if (hasAranhas) drawCard(state, enemySlot, 1, broadcast);
								broadcast("effect_log", { slot: enemySlot, cardId: emboscadaCardId, effect: "aranhas_emboscada", text: `${emboscadaCardId}: aplicou -1 ATK em ${attackerId}${hasAranhas ? " e comprou 1 carta" : ""}.` });
								continueDeclaredAttack();
							}, () => continueDeclaredAttack());
							return;
						}
					}
					continueDeclaredAttack();
				});
				return;
			}
		}

		continueDeclaredAttack();
	};

	const contricaoIndex = enemy.hand.findIndex((cid: string) => String(findCardDef(String(cid || ""))?.effect || "") === "freeser");
	if (contricaoIndex >= 0) {
		const attackValueForReaction = getCombatAttackValue(state, slot, attackerId, attackerPos, reactiveAttackPenalty);
		const declaredTargetCardId = target.type === "ally"
			? String(enemy.field[target.targetPos] || "")
			: String(enemy.leaderId || "");
		const declaredTargetName = target.type === "ally"
			? (declaredTargetCardId || "Aliado")
			: String(enemy.leaderId || "Líder");
		const declaredTargetResistance = getTargetResistance(state, enemySlot, target);
		const declaredTargetHp = target.type === "ally"
			? getTargetHP(state, enemySlot, target.targetPos)
			: Number(enemy.hp || 0);
		const declaredTargetMaxHp = target.type === "ally"
			? getCardDynamicMaxHp(state, enemySlot, target.targetPos, declaredTargetCardId)
			: Math.max(1, getCardMaxHp(String(enemy.leaderId || "")) + getAttachedSupportNumericBonus(enemy, null, "hpBonus") + getLeaderBlessing(state, enemySlot));
		const contricaoCardId = String(enemy.hand[contricaoIndex] || "");
		const contricaoCost = getCardCost(contricaoCardId);
		if (contricaoCardId && Number(enemy.fragments || 0) >= contricaoCost) {
			const options: ChoiceOption[] = [
				{ id: "contricao-yes", label: `Ativar ${contricaoCardId}`, description: `Pagar ${contricaoCost} fragmento(s) para negar o ataque e manter o atacante exaurido até o fim do próximo turno do oponente.` },
				{ id: "contricao-no", label: "Não ativar" }
			];
			askChoice(enemySlot, {
				title: `${contricaoCardId}: deseja negar o ataque de ${attackerId}?`,
				options,
				allowCancel: true,
				attackerId,
				attackerName: attackerDef?.name || attackerId,
				attackerAttack: attackValueForReaction,
				targetCardId: declaredTargetCardId,
				targetName: declaredTargetName,
				targetResistance: declaredTargetResistance,
				targetHp: declaredTargetHp,
				targetMaxHp: declaredTargetMaxHp
			}, (optionId) => {
				if (optionId === "contricao-yes") {
					const liveContricaoIndex = enemy.hand.findIndex((cid: string) => String(cid || "") === contricaoCardId);
					if (liveContricaoIndex >= 0 && Number(enemy.fragments || 0) >= contricaoCost) {
						enemy.fragments -= contricaoCost;
						enemy.hand.splice(liveContricaoIndex, 1);
						enemy.grave.push(contricaoCardId);
						maybeOfferCounterToActivation(state, enemySlot, contricaoCardId, broadcast, askChoice, () => {
							if (isLeaderAttacker) {
								(me as any).leaderTapped = true;
								(me as any).leaderFrozen = Math.max(1, Number((me as any).leaderFrozen || 0));
								(me as any).leaderPinnedUntilTurn = Math.max(Number((me as any).leaderPinnedUntilTurn || 0), Number(state.game.turn || 0) + 2);
							} else {
								attacked[slot].add(attackerPos);
								(me as any).fieldTapped[attackerPos] = true;
								(me as any).fieldFrozen[attackerPos] = Math.max(1, Number((me as any).fieldFrozen[attackerPos] || 0));
								(me as any).fieldPinnedUntilTurn[attackerPos] = Math.max(Number((me as any).fieldPinnedUntilTurn[attackerPos] || 0), Number(state.game.turn || 0) + 2);
							}
							broadcast("effect_log", { slot: enemySlot, cardId: contricaoCardId, effect: "freeser", text: `${contricaoCardId}: negou o ataque de ${attackerId} e o manteve exaurido até o fim do próximo turno do oponente.` });
						}, () => offerEmboscadaReaction());
						return;
					}
				}
				offerEmboscadaReaction();
			});
			return;
		}
	}

	offerEmboscadaReaction();
}
