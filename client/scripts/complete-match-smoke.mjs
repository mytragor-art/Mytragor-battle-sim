import assert from 'node:assert/strict';
import { Client } from 'colyseus.js';
import { setTimeout as sleep } from 'node:timers/promises';

const endpoint = process.env.ENDPOINT;
if (!endpoint) throw new Error('Set ENDPOINT to an isolated acceptance backend.');
const http = endpoint.replace(/^ws/, 'http').replace(/\/$/, '');
const timeout = Number(process.env.TIMEOUT_MS || 180000);
const leader = 'Valbrak, O Mago Popular';
const rooms = new Set();
const checks = [];
const startedAt = Date.now();

async function waitFor(predicate, label, duration = 15000) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(`Timed out: ${label}`);
}

function bind(room, slot = '') {
  rooms.add(room);
  const view = { room, slot, state: null, start: null, events: [], choices: [], autoChoices: true, errors: [] };
  room.onMessage('*', (type, payload) => {
    view.events.push({ type, payload });
    if (type === 'assign_slot' && payload.slot) view.slot = payload.slot;
    if (type === 'start_match') view.start = payload;
    if (type === 'server_error' || type === 'error') view.errors.push(payload);
    if (type === 'effect_choice_required') {
      view.choices.push(payload);
      if (view.autoChoices) answer(view, payload);
    }
  });
  room.onStateChange(state => { view.state = state; });
  return view;
}

function answer(view, choice) {
  const enabled = choice.options.filter(option => !option.disabled);
  const option = enabled.find(option => option.id === 'target-enemy-leader')
    || enabled.find(option => /^(skip|decline|no|cancel)$/.test(option.id))
    || enabled[0];
  assert.ok(option || choice.allowCancel, 'Every decision must have a valid response');
  view.room.send('effect_choice_submit', { choiceId: choice.choiceId, optionId: option?.id || null });
}

function deck(card, label) {
  return { deckId: `acceptance-${label}`, leaderId: leader, cards: Array(40).fill(card) };
}

async function opening(players, starter = 'p1') {
  await waitFor(() => players.every(player => player.state), 'initial state');
  await waitFor(() => {
    for (const player of players) {
      if (player.state.initiativeStatus === 'ROLLING') player.room.send('roll_initiative');
      if (player.state.initiativeStatus === 'CHOOSING'
        && player.state.initiativeWinnerSlot === player.slot) {
        player.room.send('choose_starter', { starterSlot: starter });
      }
    }
    return players.every(player => player.state.game.phase === 'MULLIGAN');
  }, 'initiative and opening hand');
  for (const player of players) {
    assert.ok(player.state.game[player.slot].hand.length > 0);
    player.room.send('submit_mulligan', { indices: [] });
  }
  await waitFor(() => players.every(player => player.state.game.phase !== 'MULLIGAN'), 'mulligan resolution');
}

async function createPvp(card, attackerSlot = 'p1') {
  const client = new Client(endpoint);
  const lobby1 = bind(await client.create('lobby'));
  const lobby2 = bind(await new Client(endpoint).joinById(lobby1.room.id));
  await waitFor(() => lobby1.slot && lobby2.slot, 'lobby assignments');
  for (const lobby of [lobby1, lobby2]) {
    lobby.room.send('set_name', { name: `Acceptance ${lobby.slot}` });
    lobby.room.send('choose_deck', deck(lobby.slot === attackerSlot ? card : 'Quebra-Aço', lobby.slot));
    lobby.room.send('choose_leader', { leaderId: leader });
  }
  for (const lobby of [lobby1, lobby2]) lobby.room.send('ready', { ready: true });
  await waitFor(() => lobby1.start && lobby2.start, 'lobby hands off both reserved seats');
  assert.equal(lobby1.start.matchRoomId, lobby2.start.matchRoomId);
  const players = [];
  for (const lobby of [lobby1, lobby2]) {
    players.push(bind(await new Client(endpoint).joinById(lobby.start.matchRoomId,
      { joinToken: lobby.start.joinToken }), lobby.slot));
  }
  await opening(players, attackerSlot);
  const spectator = bind(await new Client(endpoint).joinById(lobby1.start.spectatorRoomId));
  await waitFor(() => spectator.state?.game?.p1?.hand?.length > 0, 'spectator snapshot');
  assertMasked(spectator);
  return { players, spectator, attackerSlot, card };
}

async function createSolo() {
  const lobby = bind(await new Client(endpoint).create('solo_lobby'));
  await waitFor(() => lobby.slot === 'p1', 'solo lobby assignment');
  lobby.room.send('choose_deck', deck('Cão de Caça Feroz', 'solo-human'));
  lobby.room.send('choose_leader', { leaderId: leader });
  lobby.room.send('choose_bot_deck', deck('Quebra-Aço', 'solo-bot'));
  lobby.room.send('ready', { ready: true });
  await waitFor(() => lobby.start, 'solo lobby handoff');
  const human = bind(await new Client(endpoint).joinById(lobby.start.matchRoomId,
    { joinToken: lobby.start.joinToken }), 'p1');
  await opening([human]);
  return { players: [human], spectator: null, attackerSlot: 'p1', card: 'Cão de Caça Feroz' };
}

function assertMasked(spectator) {
  for (const slot of ['p1', 'p2']) {
    assert.ok([...spectator.state.game[slot].hand].every(id => id === '__spectator_hand_hidden__'));
    assert.ok([...spectator.state.game[slot].deck].every(id => id === '__spectator_deck_hidden__'));
  }
  assert.equal(spectator.choices.length, 0, 'Spectators never receive private decisions');
}

async function reconnect(context, index) {
  const previous = context.players[index];
  const roomId = previous.room.id;
  const sessionId = previous.room.sessionId;
  const token = previous.room.reconnectionToken;
  assert.ok(token);
  const hand = [...previous.state.game[previous.slot].hand];
  const peer = context.players.find(player => player !== previous);
  const peerEvents = peer?.events.length || 0;
  await previous.room.leave(false);
  if (peer) {
    await waitFor(() => peer.events.slice(peerEvents).some(event => event.type === 'opponent_reconnecting'),
      'opponent is notified of the dropped connection');
  } else {
    await sleep(100);
  }
  const restored = bind(await new Client(endpoint).reconnect(token), previous.slot);
  context.players[index] = restored;
  await waitFor(() => restored.state, 'full snapshot after reconnect');
  assert.equal(restored.room.id, roomId);
  assert.equal(restored.room.sessionId, sessionId);
  assert.deepEqual([...restored.state.game[restored.slot].hand], hand, 'Reconnect preserves the hand');
  if (peer) {
    await waitFor(() => peer.events.slice(peerEvents).some(event => event.type === 'opponent_reconnected'),
      'opponent sees successful recovery');
  }
  return restored;
}

async function playToEnd(context, { reconnectPrep = false, reconnectChoice = false } = {}) {
  const deadline = Date.now() + timeout;
  let reconnected = false;
  let plays = 0;
  let attacks = 0;
  while (Date.now() < deadline) {
    const reference = context.players[0];
    if (reference.state.phase === 'FINISHED') break;
    const turnSlot = reference.state.game.turnSlot;
    let active = context.players.find(player => player.slot === turnSlot);
    if (!active) { await sleep(40); continue; }
    if (reconnectPrep && !reconnected && active.slot === context.attackerSlot
      && active.state.game.phase === 'PREP') {
      active = await reconnect(context, context.players.indexOf(active));
      reconnected = true;
    }
    const phase = active.state.game.phase;
    const turn = active.state.game.turn;
    assert.ok(turn < 80, 'Match must progress without endlessly passing');
    const me = active.state.game[active.slot];
    const enemy = active.slot === 'p1' ? 'p2' : 'p1';
    const gameFinished = () => active.state.phase === 'FINISHED';
    if (phase === 'PREP' && active.slot === context.attackerSlot) {
      const card = context.card;
      const cost = card === 'Mãos Flamejantes' ? 2 : 4;
      const position = [...me.field].findIndex(id => !id);
      const spell = card === 'Mãos Flamejantes';
      if (me.hand.includes(card) && me.fragments >= cost && (spell || position >= 0)) {
        const handSize = me.hand.length;
        const hp = active.state.game[enemy].hp;
        if (reconnectChoice && !reconnected) active.autoChoices = false;
        active.room.send('play_card', { cardId: card, cardKind: spell ? 'spell' : 'ally', targetPos: position });
        if (reconnectChoice && !reconnected) {
          const choice = await waitFor(() => active.choices.at(-1), 'target decision before reconnect');
          await waitFor(() => active.state.game[active.slot].hand.length < handSize,
            'played card state patch before disconnect');
          const index = context.players.indexOf(active);
          active = await reconnect(context, index);
          answer(active, choice);
          reconnected = true;
        }
        await waitFor(() => gameFinished() || (spell
          ? active.state.game[enemy].hp < hp
          : active.state.game[active.slot].hand.length < handSize), 'card resolves');
        plays++;
        continue;
      }
    }
    if (phase === 'COMBAT' && active.slot === context.attackerSlot && context.card !== 'Mãos Flamejantes') {
      for (let position = 0; position < me.field.length && !gameFinished(); position++) {
        if (!me.field[position] || me.fieldTapped[position]) continue;
        // The first turn cannot attack, including units with Investida.
        if ((active.slot === active.state.game.starterSlot ? turn <= 1 : turn <= 2)) continue;
        const eventsBefore = active.events.length;
        active.room.send('attack', { attackerPos: position, target: 'leader' });
        await waitFor(() => gameFinished() || active.events.slice(eventsBefore)
          .some(event => event.type === 'attack_resolved'), 'combat resolves');
        attacks++;
      }
    }
    if (gameFinished()) break;
    if (phase === 'INITIAL' || phase === 'PREP' || phase === 'COMBAT') {
      active.room.send('next_phase');
      await waitFor(() => gameFinished() || active.state.game.phase !== phase
        || active.state.game.turn !== turn, 'phase advances');
    } else if (phase === 'END') {
      active.room.send('end_turn');
      await waitFor(() => gameFinished() || active.state.game.turn !== turn, 'turn advances');
    } else {
      throw new Error(`Unexpected phase during gameplay: ${phase}`);
    }
  }
  await waitFor(() => context.players.every(player => player.state.phase === 'FINISHED'), 'match finishes', 2000);
  for (const player of context.players) {
    assert.deepEqual(player.errors, [], 'No server/game errors during the match');
    const ended = player.events.find(event => event.type === 'match_ended')?.payload;
    assert.equal(ended?.winner, context.attackerSlot);
    assert.ok(player.state.game[context.attackerSlot === 'p1' ? 'p2' : 'p1'].hp <= 0);
  }
  assert.ok(plays > 0);
  if (context.card !== 'Mãos Flamejantes') assert.ok(attacks > 0);
  if (reconnectPrep || reconnectChoice) assert.ok(reconnected);
  await assertFinished(context);
  return { turns: context.players[0].state.game.turn, plays, attacks, reconnected };
}

async function assertFinished(context) {
  const view = context.players[0];
  const ended = view.events.find(event => event.type === 'match_ended').payload;
  if (context.spectator) {
    await waitFor(() => context.spectator.state.phase === 'FINISHED'
      && context.spectator.events.some(event => event.type === 'match_ended'), 'spectator receives the result');
    assertMasked(context.spectator);
    assert.equal(context.spectator.events.find(event => event.type === 'match_ended').payload.winner, ended.winner);
  }
  const snapshot = JSON.stringify(view.state.game);
  for (const player of context.players) {
    player.room.send('next_phase');
    player.room.send('end_turn');
    player.room.send('play_card', { cardId: context.card, targetPos: 0 });
    player.room.send('attack', { attackerPos: 0, target: 'leader' });
  }
  await sleep(150);
  assert.equal(view.state.phase, 'FINISHED');
  assert.equal(JSON.stringify(view.state.game), snapshot, 'A finished match rejects gameplay actions');
}

async function cleanup() {
  const active = [...rooms].filter(room => room.connection?.isOpen);
  const results = await Promise.allSettled(active.map(room => {
    const leaving = room.leave();
    return waitFor(() => !room.connection.isOpen, `cleanup ${room.id}`, 5000).then(() => leaving);
  }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Match cleanup failed');
}

async function scenario(name, run) {
  try {
    const details = await run();
    checks.push({ name, ...details });
    console.log(`[COMPLETE_MATCH] PASS ${name} ${JSON.stringify(details)}`);
  } finally {
    await cleanup();
  }
}

async function main() {
  const response = await fetch(`${http}/matches`);
  assert.equal(response.status, 200);
  await scenario('pvp-combat-and-reconnection', async () => playToEnd(
    await createPvp('Cão de Caça Feroz'), { reconnectPrep: true }));
  await scenario('pvp-spell-victory-and-pending-choice-reconnection', async () => playToEnd(
    await createPvp('Mãos Flamejantes', 'p2'), { reconnectChoice: true }));
  await scenario('pvp-concession', async () => {
    const context = await createPvp('Cão de Caça Feroz');
    const conceding = context.players.find(player => player.slot === 'p1');
    conceding.room.send('concede');
    await waitFor(() => context.players.every(player => player.state.phase === 'FINISHED'), 'concession propagates');
    for (const player of context.players) {
      const result = player.events.find(event => event.type === 'match_ended').payload;
      assert.equal(result.winner, 'p2');
      assert.equal(result.reason, 'concede');
    }
    await assertFinished(context);
    return { winner: 'p2', reason: 'concede' };
  });
  await scenario('solo-combat-victory-and-reconnection', async () => playToEnd(
    await createSolo(), { reconnectPrep: true }));
  console.log(`[COMPLETE_MATCH] ${checks.length} scenarios passed in ${Date.now() - startedAt}ms`);
}

main().catch(error => {
  console.error('[COMPLETE_MATCH] FAIL', error);
  process.exitCode = 1;
});
