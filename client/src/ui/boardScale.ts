const root = document.documentElement;

function recalcArenaScale() {
	try {
		const stage = document.querySelector(".boardStage") as HTMLElement | null;
		const wrap = document.querySelector(".boardWrap") as HTMLElement | null;
		const board = document.querySelector(".battleTable, .board") as HTMLElement | null;
		if (!stage || !wrap) return;

		const rect = wrap.getBoundingClientRect();
		const safeWidth = Math.max(rect.width - 8, 1);
		const safeHeight = Math.max(rect.height - 14, 1);
		const arenaW = Math.max(board?.offsetWidth || 0, stage.offsetWidth || 0, parseFloat(getComputedStyle(root).getPropertyValue("--arena-w")) || 1000);
		const arenaH = Math.max(board?.offsetHeight || 0, stage.offsetHeight || 0, parseFloat(getComputedStyle(root).getPropertyValue("--arena-h")) || 800);

		const scaleX = safeWidth / arenaW;
		const scaleY = safeHeight / arenaH;
		const isMobileBoard = window.matchMedia("(max-width: 980px)").matches;
		const isPortraitMobile = isMobileBoard && window.matchMedia("(orientation: portrait)").matches;
		const isShortMobile = isMobileBoard && window.innerHeight <= 500;

		let scale = Math.min(scaleX, scaleY);
		if (!Number.isFinite(scale) || scale <= 0) scale = 1;
		const isCompactDesktop = !isMobileBoard && (window.innerWidth < 1180 || window.innerHeight < 760);
		const minScale = isShortMobile ? 0.32 : isPortraitMobile ? 0.34 : isMobileBoard ? 0.42 : isCompactDesktop ? 0.42 : 0.6;
		scale = Math.max(minScale, Math.min(scale, 1.2));

		root.style.setProperty("--scale", String(scale));
		stage.style.transform = `scale(${scale})`;

		const baseCardW = parseFloat(getComputedStyle(root).getPropertyValue("--cardW-base")) || 75;
		const baseCardH = parseFloat(getComputedStyle(root).getPropertyValue("--cardH-base")) || 106;
		const cardW = isMobileBoard ? baseCardW : Math.round(baseCardW * scale);
		const cardH = isMobileBoard ? baseCardH : Math.round(baseCardH * scale);
		root.style.setProperty("--cardW", `${cardW}px`);
		root.style.setProperty("--cardH", `${cardH}px`);
	} catch (error) {
		console.warn("recalcArenaScale error", error);
	}
}

export function setupBoardScale() {
	window.addEventListener("resize", () => {
		clearTimeout((window as any).__arenaScaleTO);
		recalcArenaScale();
		(window as any).__arenaScaleTO = setTimeout(recalcArenaScale, 80);
		setTimeout(recalcArenaScale, 220);
	});

	window.addEventListener("orientationchange", recalcArenaScale);
	window.addEventListener("load", () => {
		setTimeout(recalcArenaScale, 60);
	});

	(window as any).recalcArenaScale = recalcArenaScale;
	recalcArenaScale();
}
