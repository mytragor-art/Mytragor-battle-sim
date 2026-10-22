import fs from "fs/promises";
import path from "path";
import "dotenv/config";
import { findCardDef } from "../game/cardCatalog";

type Mode = "pvp" | "solo" | "ai";
type Counter = { name: string; decks: number; copies: number; plays: number };
type Bucket = { decks: number; leaders: Record<string, Counter>; cards: Record<string, Counter> };
type Data = { version: 1; days: Record<string, Partial<Record<Mode, Bucket>>> };
const MODES: Mode[] = ["pvp", "solo", "ai"];
const DAY = 86_400_000;

function validData(value: any): value is Data {
	const object = (item: any) => item && typeof item === "object" && !Array.isArray(item);
	const count = (item: any) => Number.isSafeInteger(item) && item >= 0;
	if (!object(value) || value.version !== 1 || !object(value.days)) return false;
	return Object.entries(value.days).every(([day, modes]: [string, any]) =>
		/^\d{4}-\d{2}-\d{2}$/.test(day) && object(modes)
		&& Object.entries(modes).every(([mode, bucket]: [string, any]) =>
			MODES.includes(mode as Mode) && object(bucket) && count(bucket.decks)
			&& [bucket.leaders, bucket.cards].every(rows => object(rows)
				&& Object.entries(rows).every(([id, row]: [string, any]) =>
					/^c_[a-z0-9]+$/.test(id) && object(row) && typeof row.name === "string"
					&& count(row.decks) && count(row.copies) && count(row.plays)))));
}

export class UsageStatsStore {
	private data: Data = { version: 1, days: {} };
	private timer: NodeJS.Timeout | null = null;
	private writing: Promise<void> = Promise.resolve();
	private revision = 0;
	private savedRevision = 0;
	private storageError = false;
	constructor(private file: string, private durable: boolean, private now = () => new Date()) {}

	async initialize() {
		try {
			const data = JSON.parse(await fs.readFile(this.file, "utf8"));
			if (!validData(data)) throw new Error("Invalid usage statistics file");
			this.data = data;
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.storageError = true;
				console.error("[usage-stats] Could not load data; preserving existing file, collecting in memory only.", error.message);
			}
		}
		this.prune();
	}

	private prune() {
		const cutoff = new Date(this.now().getTime() - 89 * DAY).toISOString().slice(0, 10);
		for (const day of Object.keys(this.data.days)) if (day < cutoff) delete this.data.days[day];
	}

	private bucket(mode: Mode): Bucket {
		this.prune();
		const day = this.now().toISOString().slice(0, 10);
		const daily = this.data.days[day] ||= {};
		return daily[mode] ||= { decks: 0, leaders: {}, cards: {} };
	}

	private card(id: string) {
		const def = findCardDef(id);
		if (!def) return null;
		// Stable catalog keys only: no player text, room IDs or deck names.
		const key = `c_${String(def.key || def.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
		return { key, name: def.name, kind: def.kind, img: def.img || "" };
	}

	private counter(target: Record<string, Counter>, card: { key: string; name: string }) {
		return target[card.key] ||= { name: card.name, decks: 0, copies: 0, plays: 0 };
	}

	recordDeck(mode: Mode, leaderId: string, cards: string[]) {
		const leader = this.card(leaderId);
		if (!leader || !["leader", "chosen"].includes(leader.kind || "")) return;
		const bucket = this.bucket(mode);
		bucket.decks++;
		this.counter(bucket.leaders, leader).decks++;
		const seen = new Set<string>();
		for (const id of cards.slice(0, 100)) {
			const card = this.card(id);
			if (!card || ["leader", "chosen", "fragment"].includes(card.kind || "") || /\/tokens\//i.test(card.img)) continue;
			const counter = this.counter(bucket.cards, card);
			counter.copies++;
			if (!seen.has(card.key)) counter.decks++;
			seen.add(card.key);
		}
		this.changed();
	}

	recordPlay(mode: Mode, cardId: string) {
		const card = this.card(cardId);
		if (!card || ["leader", "chosen", "fragment"].includes(card.kind || "") || /\/tokens\//i.test(card.img)) return;
		this.counter(this.bucket(mode).cards, card).plays++;
		this.changed();
	}

	private changed() {
		this.revision++;
		if (this.timer || this.storageError) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, 5000);
		this.timer.unref();
	}

	async flush() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.writing = this.writing.then(async () => {
			if (this.savedRevision === this.revision || this.storageError) return;
			const revision = this.revision;
			const contents = JSON.stringify(this.data);
			try {
				await fs.mkdir(path.dirname(this.file), { recursive: true });
				await fs.writeFile(`${this.file}.tmp`, contents, "utf8");
				await fs.rename(`${this.file}.tmp`, this.file);
				this.savedRevision = revision;
			} catch (error: any) {
				console.error("[usage-stats] Save failed:", error.message);
				// Preserve gameplay and expose degraded durability until restart.
				this.storageError = true;
			}
		});
		await this.writing;
	}

	snapshot(mode: Mode | "all" = "all", days = 30) {
		this.prune();
		const cutoff = new Date(this.now().getTime() - (days - 1) * DAY).toISOString().slice(0, 10);
		const totals: Bucket = { decks: 0, leaders: {}, cards: {} };
		for (const [day, modes] of Object.entries(this.data.days)) {
			if (day < cutoff) continue;
			for (const key of MODES) {
				if (mode !== "all" && key !== mode) continue;
				const bucket = modes[key];
				if (!bucket) continue;
				totals.decks += bucket.decks;
				for (const type of ["leaders", "cards"] as const) {
					for (const [id, value] of Object.entries(bucket[type])) {
						const counter = totals[type][id] ||= { name: value.name, decks: 0, copies: 0, plays: 0 };
						counter.decks += value.decks;
						counter.copies += value.copies;
						counter.plays += value.plays;
					}
				}
			}
		}
		return {
			updatedAt: this.now().toISOString(), days, mode, decks: totals.decks,
			storage: { persistentConfigured: this.durable, healthy: !this.storageError },
			leaders: Object.values(totals.leaders).sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name)),
			cards: Object.values(totals.cards).sort((a, b) => b.decks - a.decks || b.plays - a.plays || a.name.localeCompare(b.name))
		};
	}
}

const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
export const usageStats = new UsageStatsStore(
	process.env.USAGE_STATS_FILE || path.resolve(volume || path.join(process.cwd(), ".data"), "usage-stats.json"),
	!!(volume || process.env.USAGE_STATS_FILE)
);

// One recorder per room. Reconnection and spectators never create new counts.
export function createUsageRecorder(mode: "pvp" | "solo", store = usageStats) {
	let started = false;
	let lastPlaySeq = -1;
	let failed = false;
	return (event: string, payload: any, game: any) => {
		if (failed) return;
		try {
			if (event === "mulligan_start" && !started) {
				started = true;
				for (const slot of ["p1", "p2"]) {
					const player = game[slot];
					store.recordDeck(mode === "solo" && slot === "p2" ? "ai" : mode, player.leaderId, [...player.hand, ...player.deck]);
				}
			}
			if (started && event === "card_played" && payload?.fromHand === true && ["p1", "p2"].includes(payload.slot) && Number.isInteger(payload.seq) && payload.seq > lastPlaySeq) {
				lastPlaySeq = payload.seq;
				store.recordPlay(mode === "solo" && payload.slot === "p2" ? "ai" : mode, String(payload.cardId || ""));
			}
		} catch (error) {
			failed = true;
			console.error("[usage-stats] Room collection disabled; gameplay continues.", error);
		}
	};
}