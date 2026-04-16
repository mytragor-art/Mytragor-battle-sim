export type ClientActionType =
	| "CHOOSE_DECK"
	| "CHOOSE_LEADER"
	| "READY"
	| "PLAY_CARD"
	| "END_TURN";

export interface BaseClientAction<T extends ClientActionType> {
	type: T;
}

export interface ChooseDeckAction extends BaseClientAction<"CHOOSE_DECK"> {
	deckId: string;
}

export interface ChooseLeaderAction extends BaseClientAction<"CHOOSE_LEADER"> {
	leaderId: string;
}

export interface ReadyAction extends BaseClientAction<"READY"> {}

export interface PlayCardAction extends BaseClientAction<"PLAY_CARD"> {
	cardId: string;
}

export interface EndTurnAction extends BaseClientAction<"END_TURN"> {}

export type ClientAction =
	| ChooseDeckAction
	| ChooseLeaderAction
	| ReadyAction
	| PlayCardAction
	| EndTurnAction;

