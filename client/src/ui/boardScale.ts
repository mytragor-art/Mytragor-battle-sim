const root = document.documentElement;

function recalcArenaScale() {
	try {
		const stage = document.querySelector(".boardStage") as HTMLElement | null;
		const wrap = document.querySelector(".boardWrap") as HTMLElement | null;
		if (!stage || !wrap) return;

		const rect = wrap.getBoundingClientRect();
		const safeWidth = Math.max(rect.width - 8, 1);
		const safeHeight = Math.max(rect.height - 14, 1);
		const arenaW = parseFloat(getComputedStyle(root).getPropertyValue("--arena-w")) || 1400;
		const arenaH = parseFloat(getComputedStyle(root).getPropertyValue("--arena-h")) || 780;

		const scaleX = safeWidth / arenaW;
		const scaleY = safeHeight / arenaH;

		let scale = Math.min(scaleX, scaleY);
		if (!Number.isFinite(scale) || scale <= 0) scale = 1;
		scale = Math.max(0.6, Math.min(scale, 1.2));

		root.style.setProperty("--scale", String(scale));
		stage.style.transform = `scale(${scale})`;

		const baseCardW = parseFloat(getComputedStyle(root).getPropertyValue("--cardW-base")) || 75;
		const baseCardH = parseFloat(getComputedStyle(root).getPropertyValue("--cardH-base")) || 106;
		root.style.setProperty("--cardW", `${Math.round(baseCardW * scale)}px`);
		root.style.setProperty("--cardH", `${Math.round(baseCardH * scale)}px`);
	} catch (error) {
		console.warn("recalcArenaScale error", error);
	}
}

export function setupBoardScale() {
	window.addEventListener("resize", () => {
		clearTimeout((window as any).__arenaScaleTO);
		(window as any).__arenaScaleTO = setTimeout(recalcArenaScale, 110);
	});

	window.addEventListener("orientationchange", recalcArenaScale);
	window.addEventListener("load", () => {
		setTimeout(recalcArenaScale, 60);
	});

	(window as any).recalcArenaScale = recalcArenaScale;
	recalcArenaScale();
}
