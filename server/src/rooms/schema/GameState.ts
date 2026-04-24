import { Schema, type, ArraySchema } from "@colyseus/schema";

export type TurnPhase = "INITIAL" | "PREP" | "COMBAT" | "END";

export class PlayerGameState extends Schema {
	@type("string") slot: string = "";
	@type("string") deckId: string = "";
	@type("string") leaderId: string = "";

	@type(["string"]) deck = new ArraySchema<string>();
	@type(["string"]) hand = new ArraySchema<string>();
	@type(["string"]) field = new ArraySchema<string>();
	@type(["number"]) fieldHp = new ArraySchema<number>();
	@type(["boolean"]) fieldTapped = new ArraySchema<boolean>();
	@type(["number"]) fieldFrozen = new ArraySchema<number>();
	@type(["number"]) fieldPinnedUntilTurn = new ArraySchema<number>();
	@type(["number"]) fieldAtkTemp = new ArraySchema<number>();
	@type(["number"]) fieldAtkPerm = new ArraySchema<number>();
	@type(["number"]) fieldAcPerm = new ArraySchema<number>();
	@type(["number"]) fieldSedeMark = new ArraySchema<number>();
	@type(["number"]) fieldBloodMarks = new ArraySchema<number>();
	@type(["number"]) fieldBlessing = new ArraySchema<number>();
	@type(["number"]) fieldVitalMarks = new ArraySchema<number>();
	@type(["string"]) support = new ArraySchema<string>();
	@type(["number"]) supportAttachTo = new ArraySchema<number>();
	@type(["number"]) supportCounters = new ArraySchema<number>();
	@type("string") env: string = "";
	@type(["string"]) grave = new ArraySchema<string>();
	@type(["string"]) banished = new ArraySchema<string>();
	@type("boolean") leaderTapped: boolean = false;
	@type("number") leaderFrozen: number = 0;
	@type("number") leaderPinnedUntilTurn: number = 0;
	@type("number") leaderBlessing: number = 0;
	@type("number") leaderVitalMarks: number = 0;
	@type("number") leaderSpiderMarks: number = 0;
	@type("number") sedeVingancaTurn: number = 0;

	@type("number") fragments: number = 0;
	@type("number") fragmentMax: number = 0;
	@type("number") hp: number = 30;
}

export class GameState extends Schema {
	@type("string") starterSlot: string = "p1";
	@type("string") turnSlot: string = "p1";
	@type("number") turn: number = 1;
	@type("number") seq: number = 0;
	@type("string") phase: TurnPhase = "INITIAL";
	@type(PlayerGameState) p1 = new PlayerGameState();
	@type(PlayerGameState) p2 = new PlayerGameState();
}
