import fs from "fs";
import path from "path";
import vm from "vm";

export type CardDef = {
	name: string;
	key?: string;
	aliases?: string[];
	img?: string;
	kind?: string;
	tipo?: string;
	classe?: string;
	filiacao?: string;
	cost?: number;
	ac?: number;
	hp?: number;
	maxHp?: number;
	damage?: number;
	atkBonus?: number;
	keywords?: string[];
	text?: string;
	effect?: string;
	effectA?: any;
	effectB?: any;
	textA?: string;
	textB?: string;
	effectValue?: any;
	query?: any;
	max?: number;
};

let cache: CardDef[] | null = null;
let cachePath: string | null = null;
let cacheMtimeMs = -1;
const lookup = new Map<string, CardDef>();

function normalize(value: string): string {
	return String(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

function basenameNoExt(value: string): string {
	const file = String(value || "").split("/").pop() || "";
	return file.replace(/\.[a-z0-9]+$/i, "");
}

function basenameCardKey(value: string): string {
	return basenameNoExt(basenameNoExt(value));
}

function pathNoAssetsPrefix(value: string): string {
	return String(value || "")
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/^assets\//i, "")
		.replace(/^public\//i, "");
}

function envAliases(card: CardDef): string[] {
	const name = normalize(String(card?.name || ""));
	if (name === "tempestadearcana") return ["tempestadearcana", "tempestadearcanaenv"];
	if (name === "camposensanguentados") return ["camposensanguentados", "campoensanguentado", "camposbg"];
	if (name === "caminhodassombras") return ["caminhodassombras", "caminhosdassombras"];
	if (name === "catedralensolarada") return ["catedralensolarada"];
	return [];
}

function candidatePaths() {
	const cwd = process.cwd();
	return [
		path.resolve(cwd, "../client/public/cards/cartas.js"),
		path.resolve(cwd, "client/public/cards/cartas.js"),
		path.resolve(__dirname, "../../../client/public/cards/cartas.js"),
	];
}

function resolveCatalogFile(): { path: string; mtimeMs: number } | null {
	for (const p of candidatePaths()) {
		if (!fs.existsSync(p)) continue;
		const stats = fs.statSync(p);
		if (stats.isFile()) return { path: p, mtimeMs: stats.mtimeMs };
	}
	return null;
}

function loadFromFile(filePath: string): CardDef[] {
	const code = fs.readFileSync(filePath, "utf8");
	const wrapped = `${code}\n;typeof CARD_DEFS !== "undefined" ? CARD_DEFS : [];`;
	const result = vm.runInNewContext(wrapped, {}, { timeout: 1500 });
	if (Array.isArray(result)) return result as CardDef[];
	return [];
}

export function getCardDefs(): CardDef[] {
	const source = resolveCatalogFile();
	if (!source) {
		cache = [];
		cachePath = null;
		cacheMtimeMs = -1;
		lookup.clear();
		return cache;
	}
	if (cache && cachePath === source.path && cacheMtimeMs === source.mtimeMs) return cache;
	cache = loadFromFile(source.path);
	cachePath = source.path;
	cacheMtimeMs = source.mtimeMs;
	lookup.clear();
	for (const card of cache) {
		if (!card?.name) continue;
		const imgRaw = String(card.img || "");
		const imgClean = pathNoAssetsPrefix(imgRaw);
		const imgFile = imgRaw.split("/").pop() || "";
		const keys = [
			card.name,
			card.key || "",
			...(Array.isArray(card.aliases) ? card.aliases : []),
			basenameNoExt(imgRaw),
			basenameCardKey(imgRaw),
			basenameNoExt(imgClean),
			basenameCardKey(imgClean),
			imgFile,
			imgRaw,
			imgClean,
			`/${imgRaw}`,
			`/${imgClean}`,
			...envAliases(card)
		];
		for (const key of keys) {
			const n = normalize(key);
			if (n && !lookup.has(n)) lookup.set(n, card);
		}
	}
	return cache;
}

export function findCardDef(cardId: string): CardDef | undefined {
	getCardDefs();
	const raw = String(cardId || "");
	const direct = lookup.get(normalize(raw));
	if (direct) return direct;
	const clean = pathNoAssetsPrefix(raw);
	const byClean = lookup.get(normalize(clean));
	if (byClean) return byClean;
	const byBase = lookup.get(normalize(basenameNoExt(clean)));
	if (byBase) return byBase;
	const byStem = lookup.get(normalize(basenameCardKey(clean)));
	if (byStem) return byStem;
	// Fallback: try to match by partial inclusion of the normalized name
	const expected = normalize(raw);
	const expectedClean = normalize(clean);
	const expectedBase = normalize(basenameNoExt(clean));
	const expectedStem = normalize(basenameCardKey(clean));
	for (const card of cache || []) {
		const nameNorm = normalize(String(card.name || ""));
		const keyNorm = normalize(String(card.key || ""));
		const imgNorm = normalize(String(card.img || ""));
		const imgCleanNorm = normalize(pathNoAssetsPrefix(String(card.img || "")));
		const imgBaseNorm = normalize(basenameNoExt(String(card.img || "")));
		const imgStemNorm = normalize(basenameCardKey(String(card.img || "")));
		const candidates = [nameNorm, keyNorm, imgNorm, imgCleanNorm, imgBaseNorm].filter(Boolean);
		if (!expected) continue;
		if (expectedStem && [nameNorm, keyNorm, imgNorm, imgCleanNorm, imgBaseNorm, imgStemNorm].includes(expectedStem)) return card;
		if (candidates.some((value) => value.includes(expected) || expected.includes(value) || value.includes(expectedClean) || expectedClean.includes(value) || value.includes(expectedBase) || expectedBase.includes(value))) return card;
	}
	return undefined;
}

export function fallbackDeck(): string[] {
	const pool = getCardDefs().filter((c) => {
		const kind = String(c.kind || "").toLowerCase();
		return !!c.name && kind !== "leader" && kind !== "chosen" && kind !== "fragment";
	});
	if (!pool.length) return [];
	const out: string[] = [];
	for (let index = 0; index < 40; index += 1) {
		out.push(pool[index % pool.length].name);
	}
	return out;
}
