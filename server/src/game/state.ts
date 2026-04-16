import { Schema, type, MapSchema } from "@colyseus/schema";

export type Phase = "LOBBY" | "IN_MATCH";

export class PlayerState extends Schema {
	@type("string") sessionId: string = "";
	@type("string") slot: string = ""; // "p1" | "p2"
	@type("string") deckId: string = "";
	@type("string") leaderId: string = "";
	@type("boolean") ready: boolean = false;
}

export class MatchState extends Schema {
	@type("string") phase: string = "LOBBY"; // LOBBY | IN_MATCH
	@type({ map: PlayerState }) players = new MapSchema<PlayerState>();
	@type("string") hostSessionId: string = ""; // opcional
	@type("number") serverSeq: number = 0;
}

