import { buildCurve } from "./animationHelpers";
const DECLARATION_MS = 750;
const RESULT_MS = 650;
function parseAttack(value) {
    if (!value || typeof value !== "object")
        return null;
    const data = value;
    const attackerSlot = data.attackerSlot;
    const targetSlot = data.targetSlot || (attackerSlot === "p1" ? "p2" : "p1");
    const attackerPos = Number(data.attackerPos);
    const targetPos = data.target === "leader" ? -1 : Number(data.targetPos);
    if ((attackerSlot !== "p1" && attackerSlot !== "p2") || (targetSlot !== "p1" && targetSlot !== "p2")
        || !Number.isInteger(attackerPos) || attackerPos < -1 || attackerPos > 4
        || (data.target !== "leader" && data.target !== "ally")
        || !Number.isInteger(targetPos) || targetPos < -1 || targetPos > 4
        || (data.target === "ally" && targetPos < 0))
        return null;
    return {
        attackId: String(data.attackId || `${attackerSlot}:${attackerPos}:${data.seq || 0}`),
        attackerSlot, attackerPos, attackerName: String(data.attackerName || data.attackerId || "Atacante"),
        targetSlot, target: data.target, targetPos,
        targetName: String(data.targetName || data.targetCardId || "Alvo"),
        originalTargetName: String(data.originalTargetName || data.targetName || "Alvo"),
        redirected: data.redirected === true
    };
}
export function createCombatPresentation(resolveElement) {
    const notice = document.createElement("div");
    notice.className = "combatNotice";
    notice.id = "combatNotice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.hidden = true;
    const badge = document.createElement("strong");
    const text = document.createElement("span");
    notice.append(badge, text);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.id = "combatAttackSvg";
    svg.classList.add("combatAttackSvg");
    svg.setAttribute("aria-hidden", "true");
    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.id = "combatArrowHead";
    marker.setAttribute("viewBox", "0 0 12 12");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "6");
    marker.setAttribute("orient", "auto");
    const head = document.createElementNS(ns, "path");
    head.setAttribute("d", "M 1 1 L 11 6 L 1 11 Z");
    head.setAttribute("fill", "#ffad87");
    marker.append(head);
    defs.append(marker);
    const path = document.createElementNS(ns, "path");
    path.classList.add("combatAttackPath");
    svg.append(defs, path);
    svg.style.display = "none";
    document.body.append(svg, notice);
    const queue = [];
    const completed = new Set();
    let current = null;
    let timer = 0;
    let frame = 0;
    let delayedState = null;
    let finishMatch = null;
    let from = null;
    let to = null;
    let showingResult = false;
    function clearHighlights() {
        from?.classList.remove("combatDeclaredAttacker");
        to?.classList.remove("combatDeclaredTarget");
        from = null;
        to = null;
    }
    function draw() {
        if (!current)
            return;
        const attack = current.attack;
        const nextFrom = resolveElement(attack.attackerSlot, attack.attackerPos);
        const nextTo = resolveElement(attack.targetSlot, attack.targetPos);
        if (nextFrom !== from || nextTo !== to) {
            clearHighlights();
            from = nextFrom;
            to = nextTo;
            from?.classList.add("combatDeclaredAttacker");
            to?.classList.add("combatDeclaredTarget");
        }
        if (from && to) {
            const a = from.getBoundingClientRect();
            const b = to.getBoundingClientRect();
            path.setAttribute("d", buildCurve(a.left + a.width / 2, a.top + a.height / 2, b.left + b.width / 2, b.top + b.height / 2));
            svg.style.display = "block";
        }
        else {
            svg.style.display = "none";
        }
        frame = window.requestAnimationFrame(draw);
    }
    function flushState() {
        const apply = delayedState;
        delayedState = null;
        apply?.();
    }
    function showDeclaration() {
        if (!current)
            return;
        const attack = current.attack;
        notice.hidden = false;
        notice.dataset.stage = attack.redirected ? "redirected" : "declared";
        badge.textContent = attack.redirected ? "Interpor" : "Ataque";
        text.textContent = attack.redirected
            ? `${attack.targetName} interpõe: recebe o ataque de ${attack.attackerName} no lugar de ${attack.originalTargetName}.`
            : `${attack.attackerName} ataca ${attack.targetName}.`;
    }
    function startNext() {
        current = queue.shift() || null;
        showingResult = false;
        if (!current) {
            notice.hidden = true;
            svg.style.display = "none";
            window.cancelAnimationFrame(frame);
            clearHighlights();
            flushState();
            const done = finishMatch;
            finishMatch = null;
            done?.();
            return;
        }
        current.shownAt = performance.now();
        showDeclaration();
        window.cancelAnimationFrame(frame);
        draw();
        advance();
    }
    function advance() {
        window.clearTimeout(timer);
        if (!current || showingResult)
            return;
        if (!current.redirect && !current.result)
            return;
        const remaining = Math.max(0, DECLARATION_MS - (performance.now() - current.shownAt));
        timer = window.setTimeout(() => {
            if (!current)
                return;
            if (current.redirect) {
                current.attack = current.redirect;
                current.redirect = null;
                current.shownAt = performance.now();
                current.holdState = true;
                showDeclaration();
                window.cancelAnimationFrame(frame);
                draw();
                advance();
                return;
            }
            if (!current.result)
                return;
            showingResult = true;
            current.holdState = false;
            notice.dataset.stage = current.result.cancelled ? "cancelled" : "resolved";
            badge.textContent = current.result.cancelled ? "Ataque negado" : "Resultado";
            text.textContent = `${current.attack.attackerName} → ${current.attack.targetName}: ${current.result.text}`;
            flushState();
            timer = window.setTimeout(() => {
                if (current)
                    completed.add(current.attack.attackId);
                if (completed.size > 100) {
                    const oldest = completed.values().next().value;
                    if (oldest)
                        completed.delete(oldest);
                }
                clearHighlights();
                startNext();
            }, RESULT_MS);
        }, remaining);
    }
    function event(name, payload) {
        const attack = parseAttack(payload);
        if (!attack) {
            console.error("[COMBAT] Invalid public attack event", name, payload);
            return;
        }
        if (completed.has(attack.attackId))
            return;
        let entry = current?.attack.attackId === attack.attackId ? current : queue.find(item => item.attack.attackId === attack.attackId);
        if (!entry) {
            entry = { attack, redirect: null, result: null, shownAt: 0, holdState: true };
            queue.push(entry);
        }
        if (name === "attack_redirected") {
            entry.redirect = attack;
            entry.holdState = true;
        }
        if (name === "attack_resolved" || name === "attack_cancelled") {
            entry.holdState = true;
            const data = payload;
            entry.result = {
                cancelled: name === "attack_cancelled",
                text: name === "attack_cancelled" ? String(data.reason || "Ataque cancelado.")
                    : data.hit === false ? "Não causou dano." : `${Number(data.damage || 0)} de dano.`
            };
        }
        if (!current)
            startNext();
        else if (current === entry)
            advance();
    }
    function reaction() {
        if (current)
            current.holdState = false;
        flushState();
    }
    return {
        event,
        sync(apply, pendingAttack) {
            if (pendingAttack && typeof pendingAttack === "object"
                && "active" in pendingAttack && pendingAttack.active === true) {
                if (!current) {
                    apply();
                    event("attack_declared", pendingAttack);
                    reaction();
                    return;
                }
                if (!current.result)
                    reaction();
            }
            if (current?.holdState)
                delayedState = apply;
            else
                apply();
        },
        reaction,
        finish(done) {
            if (!current) {
                done();
                return;
            }
            finishMatch = done;
            if (!current.result)
                current.result = { cancelled: true, text: "Partida encerrada." };
            advance();
        },
        reset() {
            window.clearTimeout(timer);
            window.cancelAnimationFrame(frame);
            queue.length = 0;
            completed.clear();
            current = null;
            delayedState = null;
            finishMatch = null;
            clearHighlights();
            notice.hidden = true;
            svg.style.display = "none";
        }
    };
}
