type AttackArrowState = {
  svg: SVGSVGElement | null;
  path: SVGPathElement | null;
  fromEl: Element | null;
  active: boolean;
  pointerX: number;
  pointerY: number;
  rafId: number | null;
  listenersBound: boolean;
};

const arrowState: AttackArrowState = {
  svg: null,
  path: null,
  fromEl: null,
  active: false,
  pointerX: 0,
  pointerY: 0,
  rafId: null,
  listenersBound: false
};

function getArrowSvg() {
  if (!arrowState.svg) {
    arrowState.svg = document.getElementById("attackArrowSvg") as SVGSVGElement | null;
  }
  return arrowState.svg;
}

function getArrowPath() {
  if (!arrowState.path) {
    arrowState.path = document.getElementById("attackArrowPath") as SVGPathElement | null;
  }
  return arrowState.path;
}

function getElementCenter(el: Element) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function buildCurve(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const bend = Math.max(36, Math.min(180, Math.abs(dx) * 0.25 + Math.abs(dy) * 0.18));
  const cp1X = fromX + dx * 0.28;
  const cp1Y = fromY + (dy > 0 ? bend : -bend * 0.35);
  const cp2X = toX - dx * 0.22;
  const cp2Y = toY - (dy > 0 ? bend * 0.2 : -bend);
  return `M ${fromX} ${fromY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${toX} ${toY}`;
}

function renderArrow() {
  arrowState.rafId = null;
  if (!arrowState.active || !arrowState.fromEl) return;

  const path = getArrowPath();
  const svg = getArrowSvg();
  if (!path || !svg) return;

  const from = getElementCenter(arrowState.fromEl);
  path.setAttribute("d", buildCurve(from.x, from.y, arrowState.pointerX, arrowState.pointerY));
  svg.style.display = "block";
}

function scheduleArrowRender() {
  if (arrowState.rafId != null) return;
  arrowState.rafId = window.requestAnimationFrame(renderArrow);
}

function handlePointerMove(event: PointerEvent | MouseEvent) {
  if (!arrowState.active) return;
  arrowState.pointerX = event.clientX;
  arrowState.pointerY = event.clientY;
  scheduleArrowRender();
}

function handleViewportChange() {
  if (!arrowState.active) return;
  scheduleArrowRender();
}

export function animateEl(el: Element | null, className: string) {
  if (!el) return;
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
  el.addEventListener("animationend", () => {
    el.classList.remove(className);
  }, { once: true });
}

type TransferOrigin = Element | DOMRect | DOMRectReadOnly;

function resolveRect(origin: TransferOrigin | null) {
  if (!origin) return null;
  if (origin instanceof Element) return origin.getBoundingClientRect();
  return origin;
}

export function animateCardTransfer(origin: TransferOrigin | null, targetEl: Element | null, options?: { imageSrc?: string; durationMs?: number; fadeOut?: boolean }) {
  const fromRect = resolveRect(origin);
  const toRect = targetEl?.getBoundingClientRect();
  if (!fromRect || !toRect) return;
  if (fromRect.width <= 0 || fromRect.height <= 0 || toRect.width <= 0 || toRect.height <= 0) return;

  const ghost = document.createElement("div");
  ghost.className = "card slotCard";
  ghost.style.position = "fixed";
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "10020";
  ghost.style.transformOrigin = "top left";
  ghost.style.willChange = "transform, opacity, filter";
  ghost.style.boxShadow = "0 14px 28px rgba(0,0,0,.48)";

  const image = document.createElement("img");
  image.className = "slotCardImg";
  image.src = String(options?.imageSrc || "");
  image.alt = "Carta em movimento";
  ghost.appendChild(image);
  document.body.appendChild(ghost);

  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;
  const scaleX = toRect.width / Math.max(1, fromRect.width);
  const scaleY = toRect.height / Math.max(1, fromRect.height);
  const durationMs = Math.max(140, Number(options?.durationMs || 280));
  const endOpacity = options?.fadeOut === false ? "1" : "0.24";

  window.requestAnimationFrame(() => {
    ghost.style.transition = `transform ${durationMs}ms cubic-bezier(.2,.8,.2,1), opacity ${durationMs}ms ease, filter ${durationMs}ms ease`;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
    ghost.style.opacity = endOpacity;
    ghost.style.filter = "brightness(.88) saturate(.92)";
  });

  window.setTimeout(() => ghost.remove(), durationMs + 40);
}

export function setChosenReady(el: Element | null, ready: boolean) {
  if (!el) return;
  el.classList.toggle("chosenReady", ready);
}

export function setupAttackArrow() {
  const svg = getArrowSvg();
  const path = getArrowPath();
  if (!svg || !path) return;
  svg.style.display = "none";
  path.setAttribute("d", "");

  if (arrowState.listenersBound) return;
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
  arrowState.listenersBound = true;
}

export function startAttackArrow(fromEl: Element | null) {
  if (!fromEl) return;
  setupAttackArrow();

  const svg = getArrowSvg();
  const path = getArrowPath();
  if (!svg || !path) return;

  const from = getElementCenter(fromEl);
  arrowState.fromEl = fromEl;
  arrowState.active = true;
  arrowState.pointerX = from.x;
  arrowState.pointerY = from.y;
  svg.style.display = "block";
  scheduleArrowRender();
}

export function stopAttackArrow() {
  arrowState.active = false;
  arrowState.fromEl = null;

  if (arrowState.rafId != null) {
    window.cancelAnimationFrame(arrowState.rafId);
    arrowState.rafId = null;
  }

  const svg = getArrowSvg();
  const path = getArrowPath();
  if (path) path.setAttribute("d", "");
  if (svg) svg.style.display = "none";
}

export function bindAttackTargetHover(targetEl: Element | null) {
  if (!targetEl) return () => {};

  const handleEnter = () => {
    targetEl.classList.add("attackTargetGlow");
  };
  const handleLeave = () => {
    targetEl.classList.remove("attackTargetGlow");
  };

  targetEl.addEventListener("mouseenter", handleEnter);
  targetEl.addEventListener("mouseleave", handleLeave);

  return () => {
    targetEl.removeEventListener("mouseenter", handleEnter);
    targetEl.removeEventListener("mouseleave", handleLeave);
    targetEl.classList.remove("attackTargetGlow");
  };
}
