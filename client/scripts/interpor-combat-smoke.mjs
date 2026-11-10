import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { MatchState } = require('../../server/dist/rooms/schema/MatchState.js');
const { attack } = require('../../server/dist/rooms/match/matchEngine.js');
const { findCardDef } = require('../../server/dist/game/cardCatalog.js');
const ATTACKER = 'Cão de Caça Feroz';
const TAUNT = 'Gladiador Ousado';
const BLOCKER = 'Jabuti Barreira';
const ORDINARY = 'Aprendiz de Magia';
for (const name of [ATTACKER, TAUNT, BLOCKER, ORDINARY]) assert.ok(findCardDef(name), name);

function checkServer(slot, { target = 'taunt', choice = 'block-1', tapped = false, blocker = BLOCKER, valid = true } = {}) {
  const state = new MatchState();
  state.game.turn = 5;
  state.game.turnSlot = slot;
  state.game.phase = 'COMBAT';
  const defenderSlot = slot === 'p1' ? 'p2' : 'p1';
  const own = state.game[slot];
  const foe = state.game[defenderSlot];
  for (const player of [own, foe]) {
    player.leaderId = 'Ranza, o Arqueiro das Trevas';
    for (let pos = 0; pos < 5; pos++) {
      player.field.push('');
      player.fieldHp.push(0);
      player.fieldTapped.push(false);
    }
  }
  own.field[0] = ATTACKER;
  own.fieldHp[0] = 4;
  foe.field[0] = target === 'ordinary' ? ORDINARY : TAUNT;
  foe.fieldHp[0] = 6;
  foe.fieldTapped[0] = true;
  foe.field[1] = blocker;
  foe.fieldHp[1] = 8;
  foe.fieldTapped[1] = tapped;
  foe.field[2] = ORDINARY;
  foe.fieldHp[2] = 2;
  foe.fieldTapped[2] = true;
  const declared = target === 'leader' ? { type: 'leader' } : { type: 'ally', targetPos: target === 'invalid' ? 2 : 0 };
  const events = [];
  const attacked = { p1: new Set(), p2: new Set() };
  let requests = 0;
  const hpBefore = foe.hp;
  attack(state, slot, 0, declared, (name, payload) => events.push({ name, ...payload }),
    attacked, { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() },
    (recipient, request, resolve) => {
      requests++;
      assert.equal(recipient, defenderSlot);
      assert.deepEqual(request.options.map(option => option.id), ['block-1', 'block-cancel']);
      assert.equal(request.targetCardId, foe.field[0]);
      assert.equal(attacked[slot].size, 0, 'Wait for defense before consuming the attack');
      resolve(choice);
    });
  const eligible = valid && !tapped && blocker === BLOCKER;
  assert.equal(requests, eligible ? 1 : 0, `${slot}/${target}: eligible Interpor must be offered`);
  const resolved = events.filter(event => event.name === 'attack_resolved');
  assert.equal(resolved.length, valid ? 1 : 0);
  assert.equal(attacked[slot].has(0), valid);
  assert.equal(own.fieldTapped[0], valid);
  if (!valid) {
    assert.ok(events.some(event => event.effect === 'attack_rejected'));
    return;
  }
  const blocked = eligible && choice === 'block-1';
  assert.equal(resolved[0].targetPos, blocked ? 1 : 0);
  assert.ok(resolved[0].damage > 0);
  assert.equal(foe.fieldHp[0], blocked ? 6 : 6 - resolved[0].damage);
  assert.equal(foe.fieldHp[1], blocked ? 8 - resolved[0].damage : 8);
  assert.equal(foe.fieldTapped[1], blocked || tapped);
  assert.equal(foe.hp, hpBefore);
  assert.equal(events.filter(event => event.effect === 'bloquear').length, blocked ? 1 : 0);
}

for (const slot of ['p1', 'p2']) {
  checkServer(slot);
  checkServer(slot, { choice: 'block-cancel' });
  checkServer(slot, { choice: null });
  checkServer(slot, { tapped: true });
  checkServer(slot, { blocker: ORDINARY });
  checkServer(slot, { target: 'ordinary' });
  checkServer(slot, { target: 'invalid', valid: false });
  checkServer(slot, { target: 'leader', valid: false });
}

globalThis.document = { querySelectorAll: () => [], getElementById: () => null };
for (const extension of ['js', 'ts']) {
  let source = await readFile(new URL(`../src/game/battle.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const battle = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const side of ['you', 'ai']) {
    for (const mode of ['block', 'decline', 'tapped', 'no-keyword', 'online']) {
      const foe = side === 'you' ? 'ai' : 'you';
      const attacker = { name: ATTACKER, hp: 4, damage: 2 };
      const taunt = { name: TAUNT, hp: 6, tapped: true, keywords: ['provocar'] };
      const blocker = { name: BLOCKER, hp: 8, tapped: mode === 'tapped', keywords: mode === 'no-keyword' ? [] : ['bloquear'] };
      const ordinary = { name: ORDINARY, hp: 2, tapped: true };
      const state = { phase: 'combat', turnCount: { you: 2, ai: 2 } };
      state[side] = { leader: { hp: 30 }, allies: [attacker], grave: [] };
      state[foe] = { leader: { hp: 30 }, allies: [taunt, blocker, ordinary], grave: [] };
      const sent = [];
      let offers = 0;
      const runtime = {
        state, leaderIs: () => false,
        hasKw: (card, keyword) => (card.keywords || []).includes(keyword),
        rnd: () => 0, getAC: () => 0,
        serverAuthoritative: mode === 'online',
        shouldBlockLeader: (card, defender) => {
          offers++;
          assert.equal(card, blocker);
          assert.equal(defender, foe);
          return mode !== 'decline';
        },
        onAttackResolved: (selection, target) => sent.push({ selection, target })
      };
      const selection = { side, idx: 0 };
      const target = { type: 'ally', side: foe, index: 0 };
      assert.equal(battle.canAttackTargetQuiet(runtime, selection, target), true);
      assert.equal(battle.canAttackTargetQuiet(runtime, selection, { type: 'ally', side: foe, index: 2 }), false);
      assert.equal(battle.canAttackTargetQuiet(runtime, selection, { type: 'leader', side: foe }), false);
      battle.selectAttacker(runtime, side, 0);
      battle.resolveAttackOn(runtime, target);
      assert.equal(offers, mode === 'block' || mode === 'decline' ? 1 : 0, `${extension}/${side}/${mode}: defense choice`);
      assert.equal(taunt.hp, mode === 'block' || mode === 'online' ? 6 : 4);
      assert.equal(blocker.hp, mode === 'block' ? 6 : 8);
      assert.equal(!!blocker.tapped, mode === 'block' || mode === 'tapped');
      assert.equal(!!attacker.tapped, mode !== 'online');
      assert.equal(sent.length, mode === 'online' ? 1 : 0);
      if (mode === 'online') assert.deepEqual(sent[0].target, target, 'Server chooses the blocker, not the client');
    }
  }
}
console.log('Interpor/Desafio: 16 server and 20 client regression scenarios passed.');
