import assert from 'node:assert/strict';
import { Client } from 'colyseus.js';

// Opt-in: this creates one match and therefore adds real counts on the target.
const endpoint = process.env.ENDPOINT;
if (!endpoint) throw new Error('Set ENDPOINT to an isolated test backend, e.g. ws://127.0.0.1:2568');
const http = endpoint.replace(/^ws/, 'http').replace(/\/$/, '');
async function stats(mode) {
  const response = await fetch(`${http}/usage-stats?mode=${mode}&days=7`);
  assert.equal(response.status, 200);
  return response.json();
}

let room;
let timer;
try {
  assert.equal((await fetch(`${http}/usage-stats?mode=bad&days=7`)).status, 400);
  assert.equal((await fetch(`${http}/usage-stats?mode=solo&days=8`)).status, 400);
  // Fetch only all before joining, so solo/ai have no cached snapshot yet.
  const before = await stats('all');
  const pvpBefore = await stats('pvp');
  const joinToken = `usage-smoke-${Date.now()}`;
  const deck = { leaderId: 'ranza', cards: Array(40).fill('Cão de Caça Feroz') };
  room = await new Client(endpoint).create('solo_match', {
    joinToken,
    seatReservation: { joinToken, lobbySessionId: joinToken, slot: 'p1', displayName: 'Usage smoke' },
    p1: { ...deck, deckId: 'usage-test-human' },
    p2: { ...deck, deckId: 'usage-test-bot' },
    bot: { ...deck, displayName: 'Usage AI', deckId: 'usage-test-bot' }
  });
  room.onMessage('*', () => {});
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for actual opening hand')), 20_000);
    room.onStateChange(state => {
      if (state.phase === 'INITIATIVE') {
        if (state.initiativeStatus === 'ROLLING' && !state.p1InitiativeRoll) room.send('roll_initiative');
        if (state.initiativeStatus === 'CHOOSING') room.send('choose_starter', { starterSlot: 'p1' });
      }
      if (state.game?.phase === 'MULLIGAN') resolve();
    });
  });
  clearTimeout(timer);
  const solo = await stats('solo');
  const ai = await stats('ai');
  assert.equal(solo.decks + ai.decks, before.decks - pvpBefore.decks + 2);
  for (const data of [solo, ai]) {
    assert.ok(data.leaders.some(row => /Ranza/i.test(row.name)));
    assert.ok(data.cards.some(row => /Caça Feroz/i.test(row.name) && row.copies >= 40));
    assert.equal(JSON.stringify(data).includes(joinToken), false);
  }
  console.log('Live usage: valid/invalid API filters, actual solo opening, human/AI counts, deck copies and privacy passed.');
} finally {
  clearTimeout(timer);
  if (room) await room.leave();
}