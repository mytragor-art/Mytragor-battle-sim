import { Client, Room } from "colyseus";
import { MatchPlayerState, MatchState } from "./schema/MatchState";
import { type SpectatorSnapshot, subscribeSpectatorChannel } from "./spectatorBridge";

function replaceStringArray(target: any, values: string[]) {
	target.clear();
	for (const value of values) target.push(String(value || ""));
}

function replaceNumberArray(target: any, values: number[]) {
	target.clear();
	for (const value of values) target.push(Number(value || 0));
}

function replaceBoolArray(target: any, values: boolean[]) {
	target.clear();
	for (const value of values) target.push(!!value);
}

export class SpectatorRoom extends Room<MatchState> {
	maxClients = 100;
	private matchRoomId = "";
	private unsubscribe: (() => void) | null = null;

	onCreate(options: any) {
		this.autoDispose = false;
		this.matchRoomId = String(options?.matchRoomId || "").trim();
		if (!this.matchRoomId) throw new Error("missing_match_room_id");
		this.setState(new MatchState());
		this.setMetadata({
			matchRoomId: this.matchRoomId,
			kind: "spectator"
		});
		this.unsubscribe = subscribeSpectatorChannel(this.matchRoomId, {
			onSnapshot: (snapshot) => this.applySnapshot(snapshot),
			onEvent: (name, payload) => this.broadcast(name, payload)
		});
	}

	onJoin(client: Client) {
		client.send("assign_slot", { slot: null, spectator: true, sessionId: client.sessionId });
	}

	onDispose() {
		if (this.unsubscribe) this.unsubscribe();
	}

	private applySnapshot(snapshot: SpectatorSnapshot) {
		this.state.phase = snapshot.phase;
		this.state.serverSeq = snapshot.serverSeq;
		this.syncPublicPlayer("p1", snapshot.players.p1.displayName);
		this.syncPublicPlayer("p2", snapshot.players.p2.displayName);
		this.state.hostSessionId = "";
		this.state.game.starterSlot = snapshot.game.starterSlot;
		this.state.game.turnSlot = snapshot.game.turnSlot;
		this.state.game.turn = snapshot.game.turn;
		this.state.game.seq = snapshot.game.seq;
		this.state.game.phase = snapshot.game.phase as any;
		this.applyGamePlayer(this.state.game.p1, snapshot.game.p1);
		this.applyGamePlayer(this.state.game.p2, snapshot.game.p2);
	}

	private syncPublicPlayer(slot: "p1" | "p2", displayName: string) {
		let player = this.state.players.get(slot);
		if (!player) {
			player = new MatchPlayerState();
			player.slot = slot;
			player.sessionId = "";
			this.state.players.set(slot, player);
		}
		player.displayName = String(displayName || "");
	}

	private applyGamePlayer(target: any, source: SpectatorSnapshot["game"]["p1"]) {
		target.slot = source.slot;
		target.deckId = source.deckId;
		target.leaderId = source.leaderId;
		replaceStringArray(target.deck, source.deck);
		replaceStringArray(target.hand, source.hand);
		replaceStringArray(target.field, source.field);
		replaceNumberArray(target.fieldHp, source.fieldHp);
		replaceBoolArray(target.fieldTapped, source.fieldTapped);
		replaceNumberArray(target.fieldFrozen, source.fieldFrozen);
		replaceNumberArray(target.fieldPinnedUntilTurn, source.fieldPinnedUntilTurn);
		replaceNumberArray(target.fieldAtkTemp, source.fieldAtkTemp);
		replaceNumberArray(target.fieldAtkPerm, source.fieldAtkPerm);
		replaceNumberArray(target.fieldAcPerm, source.fieldAcPerm);
		replaceNumberArray(target.fieldSedeMark, source.fieldSedeMark);
		replaceNumberArray(target.fieldBloodMarks, source.fieldBloodMarks);
		replaceNumberArray(target.fieldBlessing, source.fieldBlessing);
		replaceNumberArray(target.fieldVitalMarks, source.fieldVitalMarks);
		replaceStringArray(target.support, source.support);
		replaceNumberArray(target.supportAttachTo, source.supportAttachTo);
		replaceNumberArray(target.supportCounters, source.supportCounters);
		target.env = source.env;
		replaceStringArray(target.grave, source.grave);
		replaceStringArray(target.banished, source.banished);
		target.leaderTapped = source.leaderTapped;
		target.leaderFrozen = source.leaderFrozen;
		target.leaderPinnedUntilTurn = source.leaderPinnedUntilTurn;
		target.leaderBlessing = source.leaderBlessing;
		target.leaderVitalMarks = source.leaderVitalMarks;
		target.leaderSpiderMarks = source.leaderSpiderMarks;
		target.sedeVingancaTurn = source.sedeVingancaTurn;
		target.fragments = source.fragments;
		target.fragmentMax = source.fragmentMax;
		target.hp = source.hp;
	}
}