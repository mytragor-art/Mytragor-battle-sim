/* Responsibility: match-only schema for runtime game state. */

import { Schema, type, MapSchema } from "@colyseus/schema";
import { GameState } from "./GameState";

export class MatchPlayerState extends Schema {
	@type("string") sessionId: string = "";
	@type("string") slot: string = "";
	@type("string") displayName: string = "";
}

export class MatchState extends Schema {
	@type("string") phase: string = "IN_MATCH";
	@type({ map: MatchPlayerState }) players = new MapSchema<MatchPlayerState>();
	@type("string") hostSessionId: string = "";
	@type("number") serverSeq: number = 0;

	@type(GameState) game: GameState = new GameState();
}
