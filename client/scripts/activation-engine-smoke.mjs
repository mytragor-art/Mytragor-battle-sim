import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MatchState } = require('../../server/dist/rooms/schema/MatchState.js');
const { playCard, activateFieldEffect, getReadyFieldActivations } = require('../../server/dist/rooms/match/matchEngine.js');
const { findCardDef, getCardDefs } = require('../../server/dist/game/cardCatalog.js');

function fixture(cardId, slot = 'p1') {
  const state = new MatchState();
  state.game.phase = 'PREP';
  state.game.turn = 5;
  state.game.turnSlot = slot;
  for (const player of [state.game.p1, state.game.p2]) {
    player.leaderId = 'Ranza, o Arqueiro das Trevas';
    player.fragments = 6;
    player.deck.push(...Array(20).fill('Cão de Caça Feroz'));
    for (let pos = 0; pos < 5; pos++) {
      player.field.push('');
      player.support.push('');
      for (const name of ['fieldHp', 'fieldFrozen', 'fieldPinnedUntilTurn', 'fieldAtkTemp', 'fieldAtkPerm', 'fieldAcPerm', 'fieldSedeMark', 'fieldBloodMarks', 'fieldBlessing', 'fieldVitalMarks']) player[name].push(0);
      player.fieldTapped.push(false);
      player.supportAttachTo.push(-2);
      player.supportCounters.push(0);
    }
  }
  const enemy = slot === 'p1' ? 'p2' : 'p1';
  state.game[enemy].field[0] = 'Cão de Caça Feroz';
  state.game[enemy].fieldHp[0] = 5;
  state.game[slot].hand.push(cardId);
  const choices = [];
  const events = [];
  const summoned = { p1: new Set(), p2: new Set() };
  const triggered = { p1: new Set(), p2: new Set() };
  const broadcast = (name, payload) => events.push({ name, ...payload });
  const ask = (owner, payload, resolve) => choices.push({ owner, payload, resolve });
  const run = () => playCard(state, slot, cardId, undefined, undefined, broadcast, summoned, triggered, ask);
  return { state, slot, enemy, cardId, choices, events, summoned, triggered, broadcast, ask, run };
}

function untouched(test) {
  const own = test.state.game[test.slot];
  assert.deepEqual(Array.from(own.hand), [test.cardId]);
  assert.equal(own.grave.length, 0);
  assert.equal(own.fragments, 6);
  assert.equal(test.events.filter(event => event.name === 'card_played').length, 0);
}

for (const slot of ['p1', 'p2']) {
  const cancel = fixture('Mãos Flamejantes', slot);
  cancel.run();
  assert.equal(cancel.choices.length, 1);
  untouched(cancel);
  cancel.choices.shift().resolve(null);
  untouched(cancel);
  assert.equal(cancel.state.game[cancel.enemy].fieldHp[0], 5);

  const resolve = fixture('Mãos Flamejantes', slot);
  resolve.run();
  untouched(resolve);
  const target = resolve.choices.shift();
  target.resolve(target.payload.options.find(option => option.pos === 0 && option.side === resolve.enemy)?.id);
  assert.equal(resolve.state.game[slot].hand.length, 0);
  assert.equal(resolve.state.game[slot].fragments, 4);
  assert.deepEqual(Array.from(resolve.state.game[slot].grave), ['Mãos Flamejantes']);
  assert.equal(resolve.state.game[resolve.enemy].fieldHp[0], 3);
  assert.equal(resolve.events.filter(event => event.name === 'card_played').length, 1);
  target.resolve(null);
  assert.equal(resolve.events.filter(event => event.name === 'card_played').length, 1);

  const nested = fixture('Tônico Revigorante', slot);
  nested.run();
  nested.choices.shift().resolve('choice-a');
  assert.equal(nested.choices.length, 1);
  untouched(nested);
  nested.choices.shift().resolve(null);
  untouched(nested);
}

console.log('Spell transactions: both slots, pending targets, cancellation, nested cancellation and exactly-once resolution passed.');

for (const slot of ['p1', 'p2']) {
  const test = fixture('Mãos Flamejantes', slot);
  const source = 'Aranhas Negras, Agiota';
  test.state.game[slot].field[0] = source;
  test.state.game[slot].fieldHp[0] = 4;
  const ready = () => getReadyFieldActivations(test.state, slot, test.summoned, test.triggered);
  const activate = () => activateFieldEffect(test.state, slot, 0, source, test.broadcast, test.summoned, test.triggered, test.ask);
  assert.equal(ready().length, 1);
  test.run();
  const normalPlay = test.choices.shift();
  assert.match(normalPlay.payload.title, /escolha alvo/);
  assert.ok(!normalPlay.payload.options.some(option => option.id.startsWith('agiota-')), 'Hand play must not offer Agiota');
  normalPlay.resolve(null);
  untouched(test);
  test.state.game.phase = 'COMBAT';
  assert.equal(ready().length, 0);
  activate();
  assert.equal(test.choices.length, 0);
  test.state.game.phase = 'PREP';
  test.state.game[slot].fieldHp[0] = 2;
  assert.equal(ready().length, 1, 'Agiota can pay lethal damage with exactly two HP');
  activate();
  test.choices.shift().resolve(null);
  assert.equal(test.state.game[slot].fieldHp[0], 2);
  test.state.game[slot].fieldHp[0] = 1;
  assert.equal(ready().length, 0);
  test.state.game[slot].fieldHp[0] = 4;
  activate();
  const confirmation = test.choices.shift();
  assert.deepEqual(confirmation.payload.options.map(option => option.id), ['activate']);
  assert.deepEqual(confirmation.payload.options, [{ id: 'activate', label: 'Sim, ativar' }], 'Confirmation must use a modal action, not require choosing the source again');
  assert.equal(confirmation.payload.allowCancel, true);
  confirmation.resolve(null);
  untouched(test);
  assert.equal(ready().length, 1);
  activate();
  test.choices.shift().resolve('activate');
  test.choices.shift().resolve('play:Mãos Flamejantes');
  untouched(test);
  assert.equal(test.state.game[slot].fieldHp[0], 4);
  test.choices.shift().resolve(null);
  untouched(test);
  assert.equal(test.state.game[slot].fieldHp[0], 4);
  assert.equal(ready().length, 1);
  activate();
  test.choices.shift().resolve('activate');
  test.choices.shift().resolve('play:Mãos Flamejantes');
  const target = test.choices.shift();
  target.resolve(target.payload.options.find(option => option.pos === 0 && option.side === test.enemy)?.id);
  assert.equal(test.state.game[slot].fieldHp[0], 2);
  assert.equal(test.state.game[slot].fragments, 6);
  assert.equal(test.state.game[slot].hand.length, 0);
  assert.equal(ready().length, 0);
  test.state.game[slot].fieldHp[0] = 4;
  test.state.game[slot].hand.push('Mãos Flamejantes');
  assert.equal(ready().length, 0, 'Once-per-turn use must survive healing');
  test.triggered[slot].clear();
  assert.equal(ready().length, 1);
  test.state.game[slot].hand.clear();
  assert.equal(ready().length, 0, 'No eligible hand card means no activation glow');

  const lethal = fixture('Mãos Flamejantes', slot);
  lethal.state.game[slot].field[0] = source;
  lethal.state.game[slot].fieldHp[0] = 2;
  const lethalActivate = () => {
    activateFieldEffect(lethal.state, slot, 0, source, lethal.broadcast, lethal.summoned, lethal.triggered, lethal.ask);
    lethal.choices.shift().resolve('activate');
    lethal.choices.shift().resolve('play:Mãos Flamejantes');
    return lethal.choices.shift();
  };
  const cancelledLethal = lethalActivate();
  untouched(lethal);
  assert.equal(lethal.state.game[slot].field[0], source);
  assert.equal(lethal.state.game[slot].fieldHp[0], 2);
  cancelledLethal.resolve(null);
  untouched(lethal);
  assert.equal(lethal.state.game[slot].field[0], source);
  assert.equal(getReadyFieldActivations(lethal.state, slot, lethal.summoned, lethal.triggered).length, 1);
  const lethalTarget = lethalActivate();
  assert.ok(!lethalTarget.payload.options.some(option => option.side === slot && option.lane === 'field' && option.pos === 0), 'Dead Agiota cannot be selected as a spell target');
  lethalTarget.resolve(lethalTarget.payload.options.find(option => option.side === lethal.enemy && option.pos === 0).id);
  assert.equal(lethal.state.game[slot].field[0], '');
  assert.ok(lethal.state.game[slot].grave.includes(source));
  assert.ok(lethal.state.game[slot].grave.includes('Mãos Flamejantes'));
  assert.equal(lethal.state.game[slot].hand.length, 0);
  assert.equal(lethal.state.game[slot].fragments, 6);
  assert.equal(lethal.state.game[lethal.enemy].fieldHp[0], 3);
  assert.equal(lethal.events.filter(event => event.name === 'card_played').length, 1);

  const cheapAlly = getCardDefs().find(card => card.kind === 'ally' && card.cost > 0 && card.cost <= 2 && !card.effect);
  assert.ok(cheapAlly, 'Catalog needs a low-cost ally without target choices for this regression');
  const summon = fixture(cheapAlly.name, slot);
  summon.state.game[slot].field[0] = source;
  summon.state.game[slot].fieldHp[0] = 2;
  activateFieldEffect(summon.state, slot, 0, source, summon.broadcast, summon.summoned, summon.triggered, summon.ask);
  summon.choices.shift().resolve('activate');
  summon.choices.shift().resolve(`play:${cheapAlly.name}`);
  assert.ok(summon.state.game[slot].field.includes(cheapAlly.name), 'Ally summon continues after Agiota dies');
  assert.ok(!summon.state.game[slot].field.includes(source));
  assert.ok(summon.state.game[slot].grave.includes(source));
  assert.equal(summon.state.game[slot].fragments, 6);
  assert.equal(summon.state.game[slot].hand.length, 0);
}

const ally = findCardDef('Cão de Caça Feroz');
const previousActivation = ally.activation;
try {
  ally.activation = { effect: 'olhar_topo', fragmentCost: 2, selfDamage: 1, exhaust: true, oncePerTurn: true };
  const test = fixture('Mãos Flamejantes');
  test.state.game.p1.field[0] = ally.name;
  test.state.game.p1.fieldHp[0] = 5;
  const ready = () => getReadyFieldActivations(test.state, 'p1', test.summoned, test.triggered);
  const activate = () => activateFieldEffect(test.state, 'p1', 0, ally.name, test.broadcast, test.summoned, test.triggered, test.ask);
  activate();
  test.choices.shift().resolve('activate');
  test.choices.shift().resolve(null);
  assert.equal(test.state.game.p1.fragments, 6);
  assert.equal(test.state.game.p1.fieldHp[0], 5);
  assert.equal(test.state.game.p1.fieldTapped[0], false);
  assert.equal(ready().length, 1);
  activate();
  test.choices.shift().resolve('activate');
  test.choices.shift().resolve('keep-top');
  assert.equal(test.state.game.p1.fragments, 4);
  assert.equal(test.state.game.p1.fieldHp[0], 4);
  assert.equal(test.state.game.p1.fieldTapped[0], true);
  assert.equal(ready().length, 0);
} finally {
  ally.activation = previousActivation;
}

console.log('Field activations: Agiota eligibility/cancel/use/reset and configurable preparation ability costs passed.');

const { SoloMatchRoom } = require('../../server/dist/rooms/SoloMatchRoom.js');
const botTest = fixture('Mãos Flamejantes', 'p2');
botTest.state.game.p2.field[0] = 'Aranhas Negras, Agiota';
botTest.state.game.p2.fieldHp[0] = 4;
assert.equal(SoloMatchRoom.prototype.performBotPrep.call({
  state: botTest.state,
  shouldUseBotLeaderPower: () => false,
  pendingChoices: new Map(),
  activeChoiceSessionId: null,
  summonedThisTurn: botTest.summoned,
  triggeredLeaderThisTurn: botTest.triggered,
  askChoice: botTest.ask,
  broadcastMatchEvent: botTest.broadcast,
  pickPlayableBotCards: () => { throw new Error('Bot must activate Agiota before playing from hand'); }
}), true);
assert.match(botTest.choices[0].payload.title, /Agiota: ativar habilidade/);
assert.deepEqual(botTest.choices[0].payload.options.map(option => option.id), ['activate']);
console.log('Bot preparation: Agiota activates directly from the field before normal hand play.');

if (process.env.ACTIVATION_LIVE_ENDPOINT) {
  const { Client } = await import('colyseus.js');
  const endpoint = process.env.ACTIVATION_LIVE_ENDPOINT;
  const pause = delay => new Promise(resolve => setTimeout(resolve, delay));
  async function wait(predicate, label) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await pause(30);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const source = 'Aranhas Negras, Agiota';
  const spell = 'Mãos Flamejantes';
  const token = `activation-${Date.now()}`;
  const cards = Array.from({ length: 40 }, (_, index) => index % 2 ? source : spell);
  const room = await new Client(endpoint).create('solo_match', {
    joinToken: token,
    seatReservation: { joinToken: token, lobbySessionId: token, slot: 'p1', displayName: 'Activation smoke' },
    p1: { leaderId: 'Ranza, o Arqueiro das Trevas', cards },
    p2: { leaderId: 'Ranza, o Arqueiro das Trevas', cards: Array(40).fill('Quebra-Aço') },
    bot: { displayName: 'Activation bot' }
  });
  let state;
  let ready = [];
  const choices = [];
  room.onStateChange(value => { state = value; });
  room.onMessage('field_activation_state', payload => { ready = payload.ready; });
  room.onMessage('effect_choice_required', payload => choices.push(payload));
  room.onMessage('*', () => {});
  async function nextChoice() {
    await wait(() => choices.length, 'activation choice');
    return choices.shift();
  }
  const submit = (choice, optionId) => room.send('effect_choice_submit', { choiceId: choice.choiceId, optionId });
  try {
    await wait(() => state, 'state');
    await wait(() => {
      if (state.initiativeStatus === 'ROLLING') room.send('roll_initiative');
      if (state.initiativeStatus === 'CHOOSING' && state.initiativeWinnerSlot === 'p1') room.send('choose_starter', { starterSlot: 'p1' });
      return state.game.phase === 'MULLIGAN';
    }, 'initiative');
    room.send('submit_mulligan', { indices: [] });
    for (let turn = 0; turn < 12; turn++) {
      await wait(() => state.game.turnSlot === 'p1' && state.game.phase === 'PREP', 'human preparation');
      if (state.game.p1.fragments >= 5 && state.game.p1.hand.includes(source) && state.game.p1.hand.includes(spell)) break;
      room.send('next_phase');
      await wait(() => state.game.phase === 'COMBAT', 'combat');
      room.send('next_phase');
      await wait(() => state.game.phase === 'END', 'end');
      room.send('end_turn');
      await wait(() => state.game.turnSlot === 'p2', 'bot turn');
    }
    assert.ok(state.game.p1.fragments >= 5 && state.game.p1.hand.includes(source) && state.game.p1.hand.includes(spell));
    const initialFragments = state.game.p1.fragments;
    const initialHand = Array.from(state.game.p1.hand);
    room.send('play_card', { cardId: spell });
    const cancelledSpell = await nextChoice();
    assert.deepEqual(Array.from(state.game.p1.hand), initialHand);
    assert.equal(state.game.p1.fragments, initialFragments);
    submit(cancelledSpell, null);
    await pause(100);
    assert.deepEqual(Array.from(state.game.p1.hand), initialHand);
    room.send('play_card', { cardId: source });
    await wait(() => state.game.p1.field.includes(source), 'Agiota summon');
    const pos = Array.from(state.game.p1.field).indexOf(source);
    await wait(() => ready.some(entry => entry.pos === pos), 'private activation readiness');
    const fragments = state.game.p1.fragments;
    const hand = Array.from(state.game.p1.hand);
    room.send('play_card', { cardId: spell });
    const normalHandPlay = await nextChoice();
    assert.match(normalHandPlay.title, /escolha alvo/);
    assert.ok(!normalHandPlay.options.some(option => option.id.startsWith('agiota-')));
    submit(normalHandPlay, null);
    await wait(() => ready.some(entry => entry.pos === pos), 'Agiota remains ready after normal hand play cancellation');
    assert.equal(state.game.p1.fieldHp[pos], 4);
    assert.deepEqual(Array.from(state.game.p1.hand), hand);
    const activate = async () => {
      room.send('activate_field_effect', { pos, cardId: source });
      const confirmation = await nextChoice();
      assert.deepEqual(confirmation.options.map(option => option.id), ['activate']);
      assert.equal(confirmation.allowCancel, true);
      submit(confirmation, 'activate');
      const handChoice = await nextChoice();
      submit(handChoice, handChoice.options.find(option => option.cardId === spell).id);
      return nextChoice();
    };
    submit(await activate(), null);
    await wait(() => ready.some(entry => entry.pos === pos), 'readiness restored after cancelling target');
    assert.deepEqual(Array.from(state.game.p1.hand), hand);
    assert.equal(state.game.p1.fieldHp[pos], 4);
    assert.equal(state.game.p1.fragments, fragments);
    const target = await activate();
    submit(target, 'target-enemy-leader');
    await wait(() => state.game.p1.fieldHp[pos] === 2 && state.game.p1.grave.includes(spell), 'activation resolved');
    assert.equal(state.game.p1.fragments, fragments);
    assert.equal(state.game.p1.hand.length, hand.length - 1);
    await wait(() => !ready.some(entry => entry.pos === pos), 'used ability no longer ready');
    console.log('Activation network: spell cancellation, private readiness, direct Agiota activation, nested cancellation and exactly-once payment passed.');
  } finally {
    await room.leave();
  }
}