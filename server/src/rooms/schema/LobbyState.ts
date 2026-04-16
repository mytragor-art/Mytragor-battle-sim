/* Responsibility: lobby-only schema for pre-match setup state. */

import { Schema, type, MapSchema } from "@colyseus/schema";

export type Slot = "p1" | "p2";

export class LobbyPlayer extends Schema {
	@type("string") sessionId = "";
	@type("string") slot: Slot = "p1";
	@type("string") displayName = "";
	@type("string") deckId = "";
	@type("string") leaderId = "";
	@type("boolean") ready = false;
}

export class LobbyState extends Schema {
	@type("string") phase: "LOBBY" | "STARTING" = "LOBBY";
	@type({ map: LobbyPlayer }) players = new MapSchema<LobbyPlayer>();
	@type("number") seq = 0;
}
