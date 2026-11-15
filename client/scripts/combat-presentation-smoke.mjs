import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Element } from './helpers/rendering-harness.mjs';

const require = createRequire(import.meta.url);
const { MatchState } = require('../../server/dist/rooms/schema/MatchState.js');
const { attack } = require('../../server/dist/rooms/match/matchEngine.js');
const bridge = require('../../server/dist/rooms/spectatorBridge.js');
const { SpectatorRoom } = require('../../server/dist/rooms/SpectatorRoom.js');

function serverFixture(slot = 'p1') {
  const state = new MatchState();
  state.game.turn = 5;
  state.game.turnSlot = slot;
  state.game.phase = 'COMBAT';
  for (const player of [state.game.p1, state.game.p2]) {
    player.leaderId = 'Valbrak, O Mago Popular';
    player.fragments = 10;
    for (let pos = 0; pos < 5; pos++) {
      player.field.push('');
      player.fieldHp.push(0);
      player.fieldTapped.push(false);
    }
  }
  state.game[slot].field[0] = 'Cão de Caça Feroz';
  state.game[slot].fieldHp[0] = 4;
  return state;
}

for (const slot of ['p1', 'p2']) {
  for (const cancellation of [false, true]) {
    const state = serverFixture(slot);
    const enemySlot = slot === 'p1' ? 'p2' : 'p1';
    if (cancellation) state.game[enemySlot].hand.push('Contrição');
    const events = [];
    let requests = 0;
    attack(state, slot, 0, { type: 'leader' }, (name, payload) => events.push({ name, payload }),
      { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() },
      (recipient, request, resolve) => {
        requests++;
        assert.equal(recipient, enemySlot);
        assert.equal(state.publicAttack.active, true);
        const snapshot = bridge.buildSpectatorSnapshot(state);
        assert.equal(snapshot.publicAttack.targetSlot, enemySlot);
        assert.equal(snapshot.publicAttack.target, 'leader');
        assert.equal(snapshot.publicAttack.attackerPos, 0);
        assert.ok(snapshot.game[enemySlot].hand.every(id => id === '__spectator_hand_hidden__'));
        const spectator = Object.create(SpectatorRoom.prototype);
        spectator.state = new MatchState();
        spectator.applySnapshot(snapshot);
        assert.equal(spectator.state.publicAttack.attackId, state.publicAttack.attackId);
        resolve('contricao-yes');
      });
    assert.equal(requests, cancellation ? 1 : 0);
    assert.equal(events[0].name, 'attack_declared');
    assert.ok(events.some(event => event.name === (cancellation ? 'attack_cancelled' : 'attack_resolved')));
    assert.equal(state.publicAttack.active, false);
    if (cancellation) {
      assert.equal(state.game[enemySlot].hp, 30);
      assert.equal(events.some(event => event.name === 'attack_resolved'), false);
    }
  }
}

const relayed = [];
const unsubscribe = bridge.subscribeSpectatorChannel('combat-test', {
  onSnapshot() {},
  onEvent(name) { relayed.push(name); }
});
for (const name of ['attack_declared', 'attack_redirected', 'attack_cancelled', 'attack_resolved', 'effect_choice_required']) {
  bridge.relaySpectatorEvent('combat-test', name, {});
}
assert.deepEqual(relayed, ['attack_declared', 'attack_redirected', 'attack_cancelled', 'attack_resolved']);
unsubscribe();
bridge.disposeSpectatorChannel('combat-test');

function clockFixture(perspective) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const slots = new Map();
  const body = new Element('body');
  for (const slot of ['p1', 'p2']) {
    for (const pos of [-1, 0, 1, 2]) {
      const element = new Element();
      const top = slot === perspective ? 450 : 100;
      element.getBoundingClientRect = () => ({ left: 100 + (pos + 1) * 80, top, width: 70, height: 100 });
      slots.set(`${slot}:${pos}`, element);
    }
  }
  const setTimeout = (fn, delay) => {
    const id = ++nextId;
    timers.set(id, { at: now + delay, fn });
    return id;
  };
  globalThis.window = {
    setTimeout, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => setTimeout(fn, 16),
    cancelAnimationFrame: id => timers.delete(id)
  };
  globalThis.document = {
    body, createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag)
  };
  globalThis.performance = { now: () => now };
  return {
    slots, body,
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
    pending: () => timers.size
  };
}

const helpersSource = await readFile(new URL('../src/animations/animationHelpers.ts', import.meta.url), 'utf8');
const helpersUrl = 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(helpersSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText).toString('base64');
let checks = 0;
for (const extension of ['ts', 'js']) {
  let source = await readFile(new URL(`../src/animations/combatPresentation.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') source = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  }).outputText;
  const module = await import('data:text/javascript;base64,' + Buffer.from(source.replace('"./animationHelpers"', JSON.stringify(helpersUrl))).toString('base64'));
  for (const perspective of ['p1', 'p2', 'spectator']) {
    for (const attackerPos of [-1, 0]) {
      for (const target of ['leader', 'ally']) {
        const clock = clockFixture(perspective === 'spectator' ? 'p1' : perspective);
        const presentation = module.createCombatPresentation((slot, pos) => clock.slots.get(`${slot}:${pos}`));
        const payload = { attackId: 'test', attackerSlot: 'p1', attackerPos, attackerName: 'Atacante',
          targetSlot: 'p2', target, targetPos: target === 'leader' ? -1 : 0, targetName: 'Alvo' };
        const notice = clock.body.children.find(child => child.id === 'combatNotice');
        const path = clock.body.children.find(child => child.id === 'combatAttackSvg').children[1];
        presentation.event('attack_declared', payload);
        assert.equal(notice.hidden, false);
        assert.ok(clock.slots.get(`p1:${attackerPos}`).classList.contains('combatDeclaredAttacker'));
        assert.ok(clock.slots.get(`p2:${payload.targetPos}`).classList.contains('combatDeclaredTarget'));
        assert.match(path.getAttribute('d'), /^M \d+ \d+ C /);
        let synced = 0;
        presentation.event('attack_resolved', { ...payload, damage: 3, hit: true });
        presentation.sync(() => synced++);
        clock.tick(749);
        assert.equal(synced, 0, 'Damage is not rendered before the public declaration');
        clock.tick(1);
        assert.equal(synced, 1);
        assert.match(notice.children[1].textContent, /3 de dano/);
        clock.tick(650);
        assert.equal(notice.hidden, true);
        assert.equal(clock.pending(), 0);
        checks++;
      }
    }
  }
  {
    const clock = clockFixture('p2');
    const presentation = module.createCombatPresentation((slot, pos) => clock.slots.get(`${slot}:${pos}`));
    const payload = { attackId: 'block', attackerSlot: 'p1', attackerPos: 0, attackerName: 'Atacante',
      targetSlot: 'p2', target: 'leader', targetPos: -1, targetName: 'Escolhido' };
    const notice = clock.body.children.find(child => child.id === 'combatNotice');
    presentation.event('attack_declared', payload);
    let synced = 0;
    presentation.sync(() => synced++);
    presentation.reaction();
    assert.equal(synced, 1, 'Private decisions are never delayed');
    clock.tick(4000);
    assert.equal(notice.hidden, false, 'Declaration remains while a reaction is pending');
    const redirect = { ...payload, target: 'ally', targetPos: 1, targetName: 'Jabuti Barreira',
      originalTargetName: 'Escolhido', redirected: true };
    presentation.event('attack_redirected', redirect);
    presentation.event('attack_resolved', { ...redirect, damage: 2, hit: true });
    clock.tick(1);
    presentation.sync(() => synced++);
    assert.equal(notice.dataset.stage, 'redirected');
    assert.equal(clock.slots.get('p2:1').classList.contains('combatDeclaredTarget'), true);
    assert.equal(clock.slots.get('p2:-1').classList.contains('combatDeclaredTarget'), false);
    clock.tick(749);
    assert.equal(synced, 2);
    assert.match(notice.children[1].textContent, /Jabuti Barreira/);
    clock.tick(650);
    assert.equal(notice.hidden, true);
    checks++;
  }
  {
    const clock = clockFixture('p2');
    const presentation = module.createCombatPresentation((slot, pos) => clock.slots.get(`${slot}:${pos}`));
    const payload = { attackId: 'fast-block', attackerSlot: 'p1', attackerPos: 0, attackerName: 'Atacante',
      targetSlot: 'p2', target: 'leader', targetPos: -1, targetName: 'Escolhido' };
    presentation.event('attack_declared', payload);
    presentation.reaction();
    clock.tick(100);
    const redirect = { ...payload, target: 'ally', targetPos: 1, targetName: 'Jabuti Barreira',
      originalTargetName: 'Escolhido', redirected: true };
    presentation.event('attack_redirected', redirect);
    presentation.event('attack_resolved', { ...redirect, hit: true, damage: 3 });
    let damageRendered = false;
    presentation.sync(() => { damageRendered = true; });
    clock.tick(649);
    assert.equal(damageRendered, false, 'A fast reaction must not reveal damage before redirection');
    clock.tick(1);
    const notice = clock.body.children.find(child => child.id === 'combatNotice');
    assert.equal(notice.dataset.stage, 'redirected');
    assert.equal(damageRendered, false);
    clock.tick(749);
    assert.equal(damageRendered, false);
    clock.tick(1);
    assert.equal(damageRendered, true);
    presentation.reset();
    checks++;
  }
  {
    const clock = clockFixture('p1');
    const presentation = module.createCombatPresentation((slot, pos) => clock.slots.get(`${slot}:${pos}`));
    const payload = { attackId: 'cancel', attackerSlot: 'p1', attackerPos: 0, attackerName: 'Atacante',
      targetSlot: 'p2', target: 'ally', targetPos: 0, targetName: 'Alvo', active: true };
    let synced = 0;
    presentation.sync(() => synced++, payload);
    assert.equal(synced, 1, 'A late spectator recovers the pending public attack');
    presentation.event('attack_cancelled', { ...payload, reason: 'Ataque negado' });
    let finished = false;
    presentation.finish(() => { finished = true; });
    clock.tick(749);
    assert.equal(finished, false, 'Result modal does not cover the final attack');
    clock.tick(651);
    assert.equal(finished, true);
    presentation.event('attack_declared', { ...payload, attackId: 'next' });
    presentation.reset();
    assert.equal(clock.pending(), 0);
    assert.equal(clock.body.children.find(child => child.id === 'combatNotice').hidden, true);
    checks++;
  }
  {
    const clock = clockFixture('p1');
    const presentation = module.createCombatPresentation((slot, pos) => clock.slots.get(`${slot}:${pos}`));
    const payload = { attackerSlot: 'p1', attackerPos: 0, attackerName: 'Atacante',
      targetSlot: 'p2', target: 'ally', targetPos: 0, targetName: 'Primeiro' };
    presentation.event('attack_declared', { ...payload, attackId: 'one' });
    presentation.event('attack_resolved', { ...payload, attackId: 'one', damage: 1, hit: true });
    presentation.event('attack_declared', { ...payload, attackId: 'two', targetName: 'Segundo' });
    presentation.event('attack_resolved', { ...payload, attackId: 'two', targetName: 'Segundo', damage: 2, hit: true });
    clock.tick(1400);
    const notice = clock.body.children.find(child => child.id === 'combatNotice');
    assert.match(notice.children[1].textContent, /Segundo/);
    clock.tick(1400);
    assert.equal(notice.hidden, true, 'Consecutive attacks are shown in order');
    checks++;
  }
  let network = await readFile(new URL(`../src/net/mp.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') network = ts.transpileModule(network, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  }).outputText;
  const networkModule = await import('data:text/javascript;base64,' + Buffer.from(network.replace('"colyseus.js"', JSON.stringify(pathToFileURL(require.resolve('colyseus.js')).href))).toString('base64'));
  const listeners = new Map();
  const received = [];
  const room = { onMessage(name, fn) { listeners.set(name, fn); }, onStateChange() {}, onLeave() {} };
  networkModule.bindMatchHandlers(room, { presentation: {
    event(name) { received.push(name); }, reaction() { received.push('reaction'); },
    sync() {}, reset() {}, finish(done) { done(); }
  } });
  for (const name of ['attack_declared', 'attack_redirected', 'attack_cancelled', 'attack_resolved', 'effect_choice_required']) listeners.get(name)({});
  assert.deepEqual(received, ['attack_declared', 'attack_redirected', 'attack_cancelled', 'attack_resolved', 'reaction']);
}
console.log(`Combat presentation: 4 server scenarios, public spectator snapshots/relay, JS/TS network wiring and ${checks} timed UI scenarios passed.`);
