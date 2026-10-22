import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { MatchState } = require('../../server/dist/rooms/schema/MatchState.js');
const { attack, endTurn } = require('../../server/dist/rooms/match/matchEngine.js');
const { findCardDef, getCardDefs } = require('../../server/dist/game/cardCatalog.js');
const RANZA = 'Ranza, o Arqueiro das Trevas';
const TARGET = 'Cervo de Galhos Brancos';
const LOW = 'Cão de Caça Feroz';
const HIGH = getCardDefs().find(card => card.kind === 'ally' && card.cost === 5)?.name;
assert.ok(HIGH, 'Need a real cost-five ally');

function fixture(slot = 'p1', attacker = LOW, target = TARGET) {
  const state = new MatchState();
  state.game.turn = 5;
  state.game.turnSlot = slot;
  state.game.phase = 'COMBAT';
  const own = state.game[slot];
  const foe = state.game[slot === 'p1' ? 'p2' : 'p1'];
  for (const player of [own, foe]) {
    player.leaderId = RANZA;
    player.deck.push(...Array(20).fill(TARGET));
    for (let pos = 0; pos < 5; pos++) {
      player.field.push('');
      for (const field of ['fieldHp', 'fieldFrozen', 'fieldPinnedUntilTurn', 'fieldAtkTemp', 'fieldAtkPerm', 'fieldAcPerm', 'fieldSedeMark', 'fieldBloodMarks', 'fieldBlessing', 'fieldVitalMarks']) player[field].push(0);
      player.fieldTapped.push(false);
    }
  }
  own.field[0] = attacker;
  own.fieldHp[0] = 10;
  own.fieldAtkPerm[0] = 20;
  foe.field[0] = target;
  foe.fieldHp[0] = 1;
  const attacked = { p1: new Set(), p2: new Set() };
  const summoned = { p1: new Set(), p2: new Set() };
  const triggered = { p1: new Set(), p2: new Set() };
  const events = [];
  const broadcast = (name, payload) => events.push({ name, ...payload });
  let block = false;
  const ask = (_slot, request, resolve) => {
    const option = block ? request.options.find(entry => entry.id === 'block-1') : null;
    resolve(option?.id ?? null);
  };
  const run = (pos = 0, targetChoice = { type: 'ally', targetPos: 0 }) => attack(state, slot, pos, targetChoice, broadcast, attacked, summoned, triggered, ask);
  return { state, own, foe, events, attacked, summoned, triggered, broadcast, ask, run, setBlock: () => { block = true; } };
}

for (const slot of ['p1', 'p2']) {
  const test = fixture(slot);
  test.run();
  assert.equal(test.own.hand.length, 1, `${slot}: cost four draws`);
  assert.ok(test.foe.grave.includes(TARGET));
  assert.equal(test.events.filter(event => event.effect === 'ranza_shadow_archer_draw').length, 1);
  test.own.field[1] = LOW;
  test.own.fieldHp[1] = 10;
  test.own.fieldAtkPerm[1] = 20;
  test.foe.field[0] = TARGET;
  test.foe.fieldHp[0] = 1;
  test.run(1);
  assert.equal(test.own.hand.length, 1, 'Second kill must not draw again');
  endTurn(test.state, test.broadcast, test.attacked, test.summoned, test.triggered, test.ask);
  endTurn(test.state, test.broadcast, test.attacked, test.summoned, test.triggered, test.ask);
  test.state.game.phase = 'COMBAT';
  const before = test.own.hand.length;
  test.foe.field[0] = TARGET;
  test.foe.fieldHp[0] = 1;
  test.run();
  assert.equal(test.own.hand.length, before + 1, 'Draw resets next turn');
}

const token = fixture('p1', LOW, 'token_povo');
token.run();
assert.equal(token.foe.field[0], '');
assert.equal(token.foe.grave.length, 0);
assert.equal(token.own.hand.length, 0, 'Tokens do not trigger grave draw');

const expensive = fixture('p1', HIGH);
expensive.run();
assert.equal(expensive.state.game.seq, 0, 'Cost five cannot attack a ready ally');
expensive.foe.fieldTapped[0] = true;
expensive.run();
assert.ok(expensive.foe.grave.includes(TARGET));
assert.equal(expensive.own.hand.length, 0, 'Cost five does not draw');

for (const interpose of [false, true]) {
  const test = fixture();
  test.foe.field[1] = 'Jabuti Barreira';
  test.foe.fieldHp[1] = 1;
  if (interpose) test.setBlock();
  test.run();
  assert.equal(test.own.hand.length, 1, 'Block/decline paths draw exactly once');
  assert.equal(test.foe.field[interpose ? 1 : 0], '');
}

const image = new URL(`../public${findCardDef(RANZA).img}`, import.meta.url);
const thumb = new URL(image.href.replace('/public/', '/public/publicadas/').replace(/\.png$/, '.thumb.webp'));
const [originalStat, thumbStat, metadata] = await Promise.all([stat(image), stat(thumb), sharp(await readFile(thumb)).metadata()]);
assert.ok(thumbStat.size < originalStat.size / 2, 'Gameplay thumbnail must be substantially smaller');
assert.ok(metadata.width <= 420 && metadata.height <= 580);

const { canAttackTargetQuiet } = await import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL('../src/game/battle.js', import.meta.url))).toString('base64')}`);
const runtime = {
  state: { phase: 'combat', turnCount: { you: 2, ai: 2 }, you: { allies: [{ hp: 4, cost: 4 }] }, ai: { allies: [{ hp: 2 }] } },
  leaderIs: (_side, key) => key === 'ranza', hasKw: () => false
};
const started = performance.now();
for (let index = 0; index < 100_000; index++) assert.equal(canAttackTargetQuiet(runtime, { side: 'you', idx: 0 }, { type: 'ally', side: 'ai', index: 0 }), true);
console.log(`Ranza engine: human/AI, once-per-turn/reset, tokens, cost five and both blocker paths passed.`);
console.log(`Thumbnail: ${originalStat.size} -> ${thumbStat.size} bytes; ${metadata.width}x${metadata.height}.`);
console.log(`Target validation: 100,000 checks in ${(performance.now() - started).toFixed(1)} ms (synthetic local benchmark).`);