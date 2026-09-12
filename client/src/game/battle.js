let ATTACK_CTX = { attacker: null, side: null };
function isBattlePhase(state) {
    const phase = String(state.phase || "").trim().toLowerCase();
    return phase === "battle" || phase === "combat";
}
function firstTurnOf(state, side) {
    return Number(state.turnCount[side] || 0) === 1;
}
function enemySide(side) {
    return side === "you" ? "ai" : "you";
}
function clearTargetHighlights() {
    for (const node of Array.from(document.querySelectorAll(".slot.clickable"))) {
        node.classList.remove("clickable");
        node.onclick = null;
    }
    for (const node of Array.from(document.querySelectorAll(".slot.selected"))) {
        node.classList.remove("selected");
    }
}
function markSlotClickable(id, onClick) {
    const element = document.getElementById(id);
    if (!element)
        return;
    element.classList.add("clickable");
    element.onclick = (event) => {
        event.stopPropagation();
        onClick();
    };
}
function markSlotSelected(id) {
    const element = document.getElementById(id);
    if (!element)
        return;
    element.classList.add("selected");
}
function currentAttackerCard(runtime) {
    const selection = ATTACK_CTX.attacker;
    if (!selection)
        return null;
    if (selection.leader)
        return runtime.state[selection.side].leader;
    return runtime.state[selection.side].allies[selection.idx] ?? null;
}
function normalizeKeyword(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function hasKeyword(runtime, card, keyword) {
    if (runtime.hasKw(card, keyword))
        return true;
    const expected = normalizeKeyword(keyword);
    for (const kw of card.keywords || []) {
        if (normalizeKeyword(kw) === expected)
            return true;
    }
    return false;
}
function isWarriorCard(card) {
    return normalizeKeyword(String(card?.classe || "")) === "guerreiro";
}
export function canAttackCard(runtime, side, card) {
    if (!isBattlePhase(runtime.state))
        return false;
    if (firstTurnOf(runtime.state, side))
        return false;
    if (!card || Number(card.hp || 0) <= 0)
        return false;
    const hasInvestida = hasKeyword(runtime, card, "investida");
    const katsu = runtime.leaderIs(side, "katsu");
    if (katsu && isWarriorCard(card)) {
        if (card.tapped)
            return false;
        if (card.summonedThisTurn && !hasInvestida)
            return false;
        return true;
    }
    if (card.tapped)
        return false;
    if (card.summonedThisTurn && !hasInvestida)
        return false;
    return true;
}
export function canAttackCardQuiet(runtime, side, card) {
    return canAttackCard(runtime, side, card);
}
export function canAttackTargetQuiet(runtime, selection, target) {
    const side = selection.side;
    const foe = enemySide(side);
    if (target.side !== foe)
        return false;
    const attacker = selection.leader ? runtime.state[side].leader : (runtime.state[side].allies[selection.idx] ?? null);
    if (selection.leader) {
        if (!attacker || attacker.tapped || Number(attacker.hp || 0) <= 0)
            return false;
        if (!isBattlePhase(runtime.state) || firstTurnOf(runtime.state, side))
            return false;
    }
    else if (!canAttackCard(runtime, side, attacker)) {
        return false;
    }
    const enemies = runtime.state[foe].allies
        .map((card, index) => ({ card, index }))
        .filter((item) => item.card && Number(item.card.hp || 0) > 0);
    const tauntersTapped = enemies.filter((item) => !!item.card.tapped && hasKeyword(runtime, item.card, "provocar"));
    const katsuWarrior = runtime.leaderIs(side, "katsu") && isWarriorCard(attacker);
    if (target.type === "leader") {
        if (!runtime.state[foe].leader || Number(runtime.state[foe].leader.hp || 0) <= 0)
            return false;
        return tauntersTapped.length === 0;
    }
    const targetCard = runtime.state[foe].allies[target.index] ?? null;
    if (!targetCard || Number(targetCard.hp || 0) <= 0)
        return false;
    if (tauntersTapped.length > 0)
        return tauntersTapped.some((item) => item.index === target.index);
    if (katsuWarrior)
        return true;
    return !!targetCard.tapped;
}
export function endAttackCleanup(runtime) {
    ATTACK_CTX = { attacker: null, side: null };
    clearTargetHighlights();
    runtime.render?.();
}
export function selectAttacker(runtime, side, idx) {
    const card = runtime.state[side].allies[idx] ?? null;
    if (!canAttackCard(runtime, side, card))
        return;
    ATTACK_CTX = { attacker: { side, idx }, side };
    if (card && runtime.tryConstricaoResponse?.(side, card, false))
        return;
    highlightTargetsFor(runtime, side);
}
export function selectLeaderAttacker(runtime, side) {
    const card = runtime.state[side].leader;
    if (!card || card.tapped || Number(card.hp || 0) <= 0)
        return;
    if (!isBattlePhase(runtime.state) || firstTurnOf(runtime.state, side))
        return;
    ATTACK_CTX = { attacker: { side, leader: true }, side };
    if (runtime.tryConstricaoResponse?.(side, card, true))
        return;
    highlightTargetsFor(runtime, side);
}
export function highlightTargetsFor(runtime, side) {
    const foe = enemySide(side);
    clearTargetHighlights();
    let anyTarget = false;
    const katsu = runtime.leaderIs(side, "katsu");
    const attacker = currentAttackerCard(runtime);
    const enemies = runtime.state[foe].allies
        .map((card, index) => ({ card, index }))
        .filter((item) => item.card && Number(item.card.hp || 0) > 0);
    const tauntersTapped = enemies.filter((item) => !!item.card.tapped && hasKeyword(runtime, item.card, "provocar"));
    if (katsu && isWarriorCard(attacker)) {
        if (tauntersTapped.length) {
            for (const taunter of tauntersTapped) {
                anyTarget = true;
                markSlotClickable(`${foe}-ally-${taunter.index}`, () => resolveAttackOn(runtime, { type: "ally", side: foe, index: taunter.index }));
            }
        }
        else {
            for (const enemy of enemies) {
                anyTarget = true;
                markSlotClickable(`${foe}-ally-${enemy.index}`, () => resolveAttackOn(runtime, { type: "ally", side: foe, index: enemy.index }));
            }
            if (runtime.state[foe].leader && Number(runtime.state[foe].leader.hp || 0) > 0) {
                anyTarget = true;
                markSlotClickable(`${foe}-leader`, () => resolveAttackOn(runtime, { type: "leader", side: foe }));
            }
        }
        if (ATTACK_CTX.attacker?.leader)
            markSlotSelected(`${side}-leader`);
        else if (ATTACK_CTX.attacker && "idx" in ATTACK_CTX.attacker)
            markSlotSelected(`${side}-ally-${ATTACK_CTX.attacker.idx}`);
        if (!anyTarget)
            runtime.log?.("Sem alvos válidos.");
        return;
    }
    if (tauntersTapped.length) {
        for (const taunter of tauntersTapped) {
            anyTarget = true;
            markSlotClickable(`${foe}-ally-${taunter.index}`, () => resolveAttackOn(runtime, { type: "ally", side: foe, index: taunter.index }));
        }
    }
    else {
        for (const enemy of enemies.filter((item) => !!item.card.tapped)) {
            anyTarget = true;
            markSlotClickable(`${foe}-ally-${enemy.index}`, () => resolveAttackOn(runtime, { type: "ally", side: foe, index: enemy.index }));
        }
        if (runtime.state[foe].leader && Number(runtime.state[foe].leader.hp || 0) > 0) {
            anyTarget = true;
            markSlotClickable(`${foe}-leader`, () => resolveAttackOn(runtime, { type: "leader", side: foe }));
        }
    }
    if (ATTACK_CTX.attacker?.leader)
        markSlotSelected(`${side}-leader`);
    else if (ATTACK_CTX.attacker && "idx" in ATTACK_CTX.attacker)
        markSlotSelected(`${side}-ally-${ATTACK_CTX.attacker.idx}`);
    if (!anyTarget)
        runtime.log?.("Sem alvos válidos.");
}
export function resolveAttackOn(runtime, target) {
    const attackSelection = ATTACK_CTX.attacker;
    if (!attackSelection) {
        endAttackCleanup(runtime);
        return;
    }
    const side = attackSelection.side;
    const foe = enemySide(side);
    const attackerCard = currentAttackerCard(runtime);
    if (!attackerCard) {
        endAttackCleanup(runtime);
        return;
    }
    const katsuWarrior = !attackSelection.leader && runtime.leaderIs(side, "katsu") && isWarriorCard(attackerCard);
    if (target.type !== "leader") {
        const targetCard = runtime.state[foe].allies[target.index];
        if (!targetCard || Number(targetCard.hp || 0) <= 0) {
            runtime.log?.("Alvo inválido.");
            endAttackCleanup(runtime);
            return;
        }
        if (!katsuWarrior && !targetCard.tapped) {
            runtime.log?.("Só é possível atacar aliados deitados.");
            endAttackCleanup(runtime);
            return;
        }
    }
    let finalTarget = target;
    const tauntersTapped = runtime.state[foe].allies
        .map((card, index) => ({ card, index }))
        .filter((entry) => entry.card && !!entry.card.tapped && Number(entry.card.hp || 0) > 0 && hasKeyword(runtime, entry.card, "provocar"));
    if (!runtime.serverAuthoritative && !tauntersTapped.length && (target.type === "leader" || target.type === "ally")) {
        const blockers = runtime.state[foe].allies
            .map((card, index) => ({ card, index }))
            .filter((entry) => {
            if (!entry.card || entry.card.tapped || Number(entry.card.hp || 0) <= 0)
                return false;
            if (!hasKeyword(runtime, entry.card, "bloquear"))
                return false;
            if (target.type === "ally" && entry.index === target.index)
                return false;
            return true;
        });
        if (blockers.length) {
            let blockerIndex = 0;
            if (blockers.length > 1) {
                const selected = runtime.chooseBlockerIndex?.(blockers, foe);
                if (typeof selected === "number" && selected >= 0 && selected < blockers.length)
                    blockerIndex = selected;
            }
            const blocker = blockers[blockerIndex];
            const wantsToBlock = runtime.shouldBlockLeader ? runtime.shouldBlockLeader(blocker.card, foe) : true;
            if (wantsToBlock) {
                blocker.card.tapped = true;
                finalTarget = { type: "ally", side: foe, index: blocker.index };
                runtime.log?.(`🛡️ Interpor: redirecionado para ${blocker.card.name} (ficou deitado).`);
            }
        }
    }
    attackerCard.tapped = true;
    if (runtime.serverAuthoritative) {
        runtime.onAttackResolved?.(attackSelection, finalTarget);
        endAttackCleanup(runtime);
        return;
    }
    const bonusTempAtk = Number(attackerCard.atkBonusTemp || 0);
    let d20 = 1 + runtime.rnd(20);
    let d20b = null;
    if (hasKeyword(runtime, attackerCard, "precisão") || hasKeyword(runtime, attackerCard, "precisao")) {
        d20b = 1 + runtime.rnd(20);
        d20 = Math.max(d20, d20b);
    }
    const total = d20 + Number(attackerCard.atkBonus || 0) + bonusTempAtk;
    const ac = runtime.getAC(finalTarget);
    const hit = total >= ac;
    const rollText = d20b !== null
        ? `Precisão: ${d20} (maior) + ${Number(attackerCard.atkBonus || 0)}${bonusTempAtk ? `+${bonusTempAtk} temp` : ""} vs AC ${ac} → ${hit ? "ACERTOU" : "ERROU"}.`
        : `Rolagem: ${d20}+${Number(attackerCard.atkBonus || 0)}${bonusTempAtk ? `+${bonusTempAtk} temp` : ""} vs AC ${ac} → ${hit ? "ACERTOU" : "ERROU"}.`;
    runtime.logAttackResult?.(hit, rollText);
    if (!hit) {
        endAttackCleanup(runtime);
        return;
    }
    const baseDamage = Number(attackerCard.damage || 1);
    const damageBonusTemp = Number(attackerCard.damageBonusTemp || 0);
    if (finalTarget.type === "leader") {
        const damage = baseDamage + damageBonusTemp;
        const leader = runtime.state[foe].leader;
        if (!leader) {
            endAttackCleanup(runtime);
            return;
        }
        leader.hp = Math.max(0, Number(leader.hp || 20) - damage);
        runtime.logEffect?.(`💥 Dano ${damage} no Escolhido (${leader.hp}).`);
        if (leader.hp === 0)
            runtime.showVictory?.(side === "you" ? "Você" : "IA", side);
        endAttackCleanup(runtime);
        return;
    }
    const targetCard = runtime.state[foe].allies[finalTarget.index];
    if (!targetCard) {
        endAttackCleanup(runtime);
        return;
    }
    let damage = baseDamage + damageBonusTemp;
    if (targetCard.damageTakenReduction)
        damage = Math.max(0, damage - Number(targetCard.damageTakenReduction || 0));
    else if (targetCard.protegido)
        damage = Math.max(0, damage - 1);
    const beforeHp = Number(targetCard.hp || 0);
    targetCard.hp = Math.max(0, beforeHp - damage);
    runtime.logEffect?.(`💥 Dano ${damage} em ${targetCard.name} (${targetCard.hp}).`);
    if (hasKeyword(runtime, attackerCard, "atropelar") && targetCard.hp === 0) {
        const overflow = damage - beforeHp;
        if (overflow > 0 && runtime.state[foe].leader) {
            runtime.state[foe].leader.hp = Math.max(0, Number(runtime.state[foe].leader.hp || 20) - overflow);
            runtime.logEffect?.(`🐘 Atropelar: excesso ${overflow} no Líder! (${runtime.state[foe].leader.hp}).`);
            if (runtime.state[foe].leader.hp === 0)
                runtime.showVictory?.(side === "you" ? "Você" : "IA", side);
        }
    }
    if (targetCard.hp === 0) {
        runtime.cleanupEquipsOf?.(foe, targetCard);
        runtime.state[foe].grave.push(targetCard);
        runtime.state[foe].allies[finalTarget.index] = null;
        runtime.notifyAllySentToGrave?.(targetCard, foe);
        runtime.logEffect?.(`☠️ Destruído: ${targetCard.name}.`);
        if (attackerCard.effect === "buff_on_kill" && attackerCard.effectValue) {
            const val = attackerCard.effectValue;
            if (val?.atk)
                attackerCard.atkBonus = Number(attackerCard.atkBonus || 0) + Number(val.atk || 0);
            if (val?.ac)
                attackerCard.ac = Number(attackerCard.ac || 0) + Number(val.ac || 0);
        }
        if (attackerCard.effect === "fragment_back") {
            const gain = Number(attackerCard.effectValue || attackerCard.value || 0);
            const beforePool = Number(runtime.state.pool?.[side] || 0);
            const maxPool = Number(runtime.state.maxPool?.[side] || 999);
            if (!runtime.state.pool)
                runtime.state.pool = {};
            runtime.state.pool[side] = Math.min(maxPool, beforePool + gain);
            runtime.log?.(`${attackerCard.name}: recuperou ${Number(runtime.state.pool[side] || 0) - beforePool} fragmento(s).`);
        }
        if (targetCard.chamarEspecial) {
            setTimeout(() => {
                runtime.specialSummonByConfig?.(foe, { ...targetCard.chamarEspecial, kind: targetCard.chamarEspecial.kind || "ally", excludeName: targetCard.name }, "Chamar Especial");
            }, 10);
        }
        if (attackerCard._sede_vinganca && !attackerCard._sede_vinganca.used) {
            attackerCard._sede_vinganca.used = true;
            runtime.draw?.(side);
            runtime.log?.("Sede de Vingança: comprou 1 carta.");
        }
    }
    endAttackCleanup(runtime);
}
