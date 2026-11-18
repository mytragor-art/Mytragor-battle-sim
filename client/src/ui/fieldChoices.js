export function createEquipmentCarrierPreview(root, resolve) {
    let highlighted = null;
    let timer = null;
    let pressed = null;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let suppressed = null;
    const clearTimer = () => {
        if (timer !== null)
            window.clearTimeout(timer);
        timer = null;
    };
    const highlight = (carrier) => {
        if (highlighted === carrier)
            return;
        highlighted?.classList.remove("choiceEquipmentCarrierHighlight");
        highlighted = carrier;
        highlighted?.classList.add("choiceEquipmentCarrierHighlight");
    };
    const reset = () => {
        if (pressed)
            suppressed = pressed.equipment;
        clearTimer();
        highlight(null);
        pressed = null;
        pointerId = null;
        stopTracking();
    };
    const targetFor = (event) => event.target instanceof Node ? resolve(event.target) : null;
    root.addEventListener("pointerover", event => {
        if (event.pointerType === "touch" || event.pointerType === "pen" || pressed)
            return;
        highlight(targetFor(event)?.carrier || null);
    }, true);
    root.addEventListener("pointerout", event => {
        if (pressed)
            return;
        const next = event.relatedTarget instanceof Node ? resolve(event.relatedTarget) : null;
        highlight(next?.carrier || null);
    }, true);
    root.addEventListener("focusin", event => {
        if (pointerId === null)
            highlight(targetFor(event)?.carrier || null);
    }, true);
    root.addEventListener("focusout", () => highlight(null), true);
    root.addEventListener("pointerdown", event => {
        suppressed = null;
        if ((event.pointerType !== "touch" && event.pointerType !== "pen") || event.button !== 0)
            return;
        reset();
        pressed = targetFor(event);
        if (!pressed)
            return;
        event.stopImmediatePropagation();
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        timer = window.setTimeout(() => {
            timer = null;
            if (!pressed)
                return;
            suppressed = pressed.equipment;
            highlight(pressed.carrier);
        }, 450);
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("pointermove", move);
    }, true);
    const move = (event) => {
        if (!pressed || event.pointerId !== pointerId)
            return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) <= 10)
            return;
        suppressed = pressed.equipment;
        clearTimer();
        highlight(null);
        pressed = null;
    };
    const release = (event) => {
        if (event.pointerId !== pointerId)
            return;
        clearTimer();
        pressed = null;
        pointerId = null;
        stopTracking();
        if (highlighted)
            timer = window.setTimeout(() => { timer = null; highlight(null); }, 900);
    };
    const cancel = (event) => {
        if (event.pointerId !== pointerId)
            return;
        reset();
    };
    function stopTracking() {
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("pointermove", move);
    }
    root.addEventListener("touchstart", event => {
        if (targetFor(event))
            event.stopImmediatePropagation();
    }, { capture: true, passive: true });
    root.addEventListener("contextmenu", event => {
        if (targetFor(event))
            event.preventDefault();
    }, true);
    root.addEventListener("click", event => {
        if (!suppressed || !(event.target instanceof Node) || !suppressed.contains(event.target) || event.detail === 0)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressed = null;
    }, true);
    return { reset };
}
export function getFieldChoiceKind(payload) {
    return payload.choiceKind || "target";
}
export function canChooseOnField(options, resolve) {
    const targets = new Set();
    for (const option of options) {
        if (!option.id)
            return false;
        const target = resolve(option);
        if (target) {
            if (option.disabled)
                continue;
            if (targets.has(target))
                return false;
            targets.add(target);
        }
        else if (option.cardId || option.lane || option.pos != null) {
            return false;
        }
    }
    return targets.size > 0;
}
export function createFieldChoiceController(resolve, submit, cancel, describeTarget = () => "", resolveCarrier = () => null) {
    const bar = document.getElementById("fieldChoiceBar");
    const title = document.getElementById("fieldChoiceTitle");
    const hint = document.getElementById("fieldChoiceHint");
    const actions = document.getElementById("fieldChoiceActions");
    const countdown = document.getElementById("fieldChoiceCountdown");
    const board = document.getElementById("board");
    if (!bar || !title || !hint || !actions || !countdown || !board) {
        throw new Error("Interface de escolha direta no campo incompleta.");
    }
    const barHome = bar.parentElement;
    const equipmentDock = document.getElementById("fieldChoiceEquipmentDock");
    const attributes = ["tabindex", "role", "aria-label", "aria-pressed", "data-choice-kind", "data-choice-carrier"];
    let state = null;
    const carrierPreview = createEquipmentCarrierPreview(board, target => {
        for (const [equipment, option] of state?.targets || []) {
            if (!equipment.contains(target))
                continue;
            const carrier = resolveCarrier(option);
            if (carrier)
                return { equipment, carrier };
        }
        return null;
    });
    const positionBar = () => {
        if (!state || bar.hidden)
            return;
        if (equipmentDock && !equipmentDock.hidden)
            return;
        const visibleTargets = new Set(state.targets.keys());
        for (const option of state.payload.options) {
            const carrier = resolveCarrier(option);
            if (carrier)
                visibleTargets.add(carrier);
        }
        const targets = Array.from(visibleTargets, element => element.getBoundingClientRect())
            .filter(rect => rect.width > 0 && rect.height > 0);
        const bounds = targets.length ? {
            left: Math.min(...targets.map(rect => rect.left)),
            right: Math.max(...targets.map(rect => rect.right)),
            top: Math.min(...targets.map(rect => rect.top)),
            bottom: Math.max(...targets.map(rect => rect.bottom))
        } : board.getBoundingClientRect();
        const size = bar.getBoundingClientRect();
        const margin = 8;
        const gap = 12;
        const maxTop = Math.max(margin, window.innerHeight - size.height - margin);
        const center = board.querySelector(".centerBar")?.getBoundingClientRect();
        const centerTop = center ? (center.top + center.bottom - size.height) / 2 : 0;
        const spansCenter = center && bounds.top < center.top && bounds.bottom > center.bottom
            && targets.every(rect => rect.bottom <= centerTop || rect.top >= centerTop + size.height);
        let top = bounds.bottom + gap;
        if (spansCenter) {
            top = centerTop;
        }
        else if (top > maxTop) {
            top = bounds.top - size.height - gap;
            if (top < margin) {
                top = center ? centerTop
                    : (window.innerHeight - size.height) / 2;
            }
            ;
        }
        const left = Math.max(size.width / 2 + margin, Math.min((bounds.left + bounds.right) / 2, window.innerWidth - size.width / 2 - margin));
        bar.style.left = `${left}px`;
        bar.style.top = `${Math.max(margin, Math.min(top, maxTop))}px`;
    };
    const positionObserver = new ResizeObserver(positionBar);
    function clearTargets() {
        carrierPreview.reset();
        if (!state)
            return;
        for (const [element, values] of state.saved) {
            element.classList.remove("choiceBoardHighlight", "choiceBoardSelected", "choiceEquipmentExpanded");
            element.style.removeProperty("--choice-equipment-column");
            attributes.forEach((attribute, index) => {
                const value = values[index];
                if (value === null)
                    element.removeAttribute(attribute);
                else
                    element.setAttribute(attribute, value);
            });
        }
        state.saved.clear();
        state.targets.clear();
    }
    function updateSelection() {
        if (!state)
            return;
        for (const [element, option] of state.targets) {
            const selected = state.selected.has(option.id);
            element.classList.toggle("choiceBoardSelected", selected);
            if (state.payload.multiSelect)
                element.setAttribute("aria-pressed", String(selected));
        }
        for (const [id, button] of state.controls) {
            if (state.payload.multiSelect)
                button.setAttribute("aria-pressed", String(state.selected.has(id)));
        }
        if (state.confirm) {
            state.confirm.disabled = state.selected.size < Math.max(0, Number(state.payload.minSelections || 0));
            state.confirm.textContent = `${state.payload.submitLabel || "Confirmar"} (${state.selected.size})`;
        }
    }
    function select(option) {
        if (!state || option.disabled)
            return;
        if (!state.payload.multiSelect) {
            submit(option.id);
            return;
        }
        if (state.selected.has(option.id))
            state.selected.delete(option.id);
        else {
            const max = Number(state.payload.maxSelections || 0);
            if (Number.isFinite(max) && max > 0 && state.selected.size >= max)
                return;
            state.selected.add(option.id);
        }
        updateSelection();
    }
    function refresh() {
        if (!state)
            return;
        clearTargets();
        for (const option of state.payload.options) {
            if (option.disabled)
                continue;
            const element = resolve(option);
            if (!element)
                continue;
            state.targets.set(element, option);
            state.saved.set(element, attributes.map(attribute => element.getAttribute(attribute)));
            element.classList.add("choiceBoardHighlight");
            element.setAttribute("data-choice-kind", getFieldChoiceKind(state.payload));
            if (option.lane === "support" && element.classList.contains("attachedEquipment")
                && Number.isInteger(option.pos) && Number(option.pos) >= 0 && Number(option.pos) < 5) {
                element.classList.add("choiceEquipmentExpanded");
                element.style.setProperty("--choice-equipment-column", String(Number(option.pos) + 1));
            }
            element.setAttribute("tabindex", "0");
            element.setAttribute("role", "button");
            const context = describeTarget(option);
            if (context)
                element.setAttribute("data-choice-carrier", context);
            element.setAttribute("aria-label", [option.label || option.cardId || "Escolher alvo", context, option.description].filter(Boolean).join(". "));
        }
        updateSelection();
        positionBar();
    }
    const hide = () => {
        clearTargets();
        state = null;
        bar.hidden = true;
        bar.classList.remove("fieldChoiceBar--docked", "fieldChoiceBar--equipment");
        if (equipmentDock)
            equipmentDock.hidden = true;
        if (barHome && bar.parentElement !== barHome)
            barHome.appendChild(bar);
        bar.removeAttribute("data-choice-kind");
        bar.style.removeProperty("left");
        bar.style.removeProperty("top");
        positionObserver.disconnect();
        window.removeEventListener("resize", positionBar);
        window.removeEventListener("scroll", positionBar, true);
        countdown.style.display = "none";
        actions.replaceChildren();
    };
    function handleBoardChoice(event) {
        if (!state)
            return;
        if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ")
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!(event.target instanceof Node))
            return;
        for (const [element, option] of state.targets) {
            if (element.contains(event.target)) {
                select(option);
                return;
            }
        }
    }
    board.addEventListener("click", handleBoardChoice, true);
    board.addEventListener("keydown", handleBoardChoice, true);
    board.addEventListener("dragstart", event => {
        if (!state)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
    return {
        get active() { return state !== null; },
        hide,
        refresh,
        show(payload) {
            hide();
            if (!canChooseOnField(payload.options, resolve))
                return false;
            const choice = {
                payload,
                selected: new Set(),
                targets: new Map(),
                saved: new Map(),
                controls: new Map(),
                confirm: null
            };
            state = choice;
            const kind = getFieldChoiceKind(payload);
            bar.setAttribute("data-choice-kind", kind);
            title.textContent = payload.title || "Escolha um alvo";
            const purpose = kind === "activation" ? "Ativar efeito"
                : kind === "replacement" ? "Substituir aliado" : "Escolher alvo";
            hint.textContent = payload.multiSelect
                ? `${purpose}: selecione as cartas destacadas e confirme.`
                : kind === "replacement" ? "Substituir aliado: clique em quem sairá para abrir a vaga."
                    : `${purpose}: clique ou toque em uma carta destacada.`;
            if (payload.options.some(option => resolveCarrier(option))) {
                hint.textContent += " Passe o mouse ou segure o equipamento para iluminar seu personagem.";
            }
            for (const option of payload.options) {
                if (resolve(option))
                    continue;
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn";
                button.textContent = option.label || option.id;
                button.disabled = !!option.disabled;
                button.onclick = () => { if (state === choice)
                    select(option); };
                choice.controls.set(option.id, button);
                actions.appendChild(button);
            }
            if (payload.multiSelect) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn primary";
                button.onclick = () => {
                    if (state === choice && !button.disabled)
                        submit(Array.from(choice.selected).join("|"));
                };
                choice.confirm = button;
                actions.appendChild(button);
            }
            if (payload.allowCancel !== false) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn";
                button.textContent = "Cancelar";
                button.onclick = () => { if (state === choice)
                    cancel(); };
                actions.appendChild(button);
            }
            const equipmentChoice = payload.options.some(option => resolveCarrier(option));
            bar.classList.toggle("fieldChoiceBar--equipment", equipmentChoice);
            bar.hidden = equipmentChoice && actions.children.length === 0 && !(Number(payload.timeoutMs) > 0);
            if (equipmentDock && equipmentChoice && !bar.hidden) {
                equipmentDock.appendChild(bar);
                equipmentDock.hidden = false;
                bar.classList.add("fieldChoiceBar--docked");
            }
            refresh();
            positionObserver.observe(bar);
            positionObserver.observe(board);
            window.addEventListener("resize", positionBar);
            window.addEventListener("scroll", positionBar, true);
            return true;
        }
    };
}
