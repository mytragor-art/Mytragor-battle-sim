import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const cards = {
  ally1: { kind: 'ally', cost: 1 },
  ally3: { kind: 'aliado', cost: 3 },
  ally6: { kind: 'ally', cost: 6 },
  spell2: { kind: 'magia', cost: 2 },
  equip2: { kind: 'equipamento', cost: 2 },
  env2: { kind: 'ambiente', cost: 2 },
  free: { kind: 'spell', cost: 0 },
  trick: { kind: 'truque', cost: 1 },
  trickAlias: { tipo: 'trick', cost: 0 },
  legacyTrick: { kind: 'spell', effect: 'bem_treinado', cost: 0 },
  legacyCounter: { kind: 'spell', effect: 'freeser', cost: 0 },
  destroyEnv: { kind: 'spell', effect: 'destroy_env', cost: 1 },
  destroyEquip: { kind: 'spell', effect: 'destroy_equip', cost: 1 },
  destroyAlly: { kind: 'spell', effect: 'destroy_enemy_ally', cost: 1 },
  missingCost: { kind: 'spell' },
  invalidCost: { kind: 'spell', cost: -1 }
};
let scenarios = 0;
for (const extension of ['js', 'ts']) {
  const source = await readFile(new URL(`../src/pages/game.${extension}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`game.${extension}`, source, ts.ScriptTarget.Latest, true);
  const names = ['normalizeKind', 'getCardKind', 'getFirstEmptyFieldPos', 'canHighlightHandCard', 'renderSideHand'];
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length, 'Exercise the actual hand renderer and eligibility logic');
  const harness = ts.transpileModule(`
    export function createHarness(options, cards) {
      const { isSpectator = false, isMatchFinished = false, isMyTurn = true, currentPhase = 'PREP',
        currentMyField = [], currentEnemyField = [], currentMySupport = [], currentEnemySupport = [],
        currentMyLeader = 'leader', currentMyEnv = null, currentEnemyEnv = null,
        summonedBySide = { you: new Set() }, selectedHandCardId = 'ally3' } = options;
      let currentMyFragments = options.fragments ?? 5;
      const resolveCard = id => cards[id];
      const container = {
        children: [],
        set innerHTML(value) { this.children = []; },
        appendChild(card) { this.children.push(card); }
      };
      const document = { getElementById: () => container };
      const previousHandCards = {};
      const getNewHandEntryFlags = entries => entries.map(() => false);
      const animateEl = () => {};
      const queueHandStackLayout = () => {};
      const buildHandCard = (id, selected, onclick) => {
        const classes = new Set(selected ? ['is-selected'] : []);
        return { id, onclick, classes, classList: {
          toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
        }};
      };
      const buildBackCard = () => ({ dataset: {}, classes: new Set() });
      ${functions.map(node => node.getText(parsed)).join('\n')}
      return {
        eligible: canHighlightHandCard,
        render(hand, selectable = true) {
          renderSideHand(selectable ? 'youHand' : 'aiHand', hand, selectable);
          return container.children;
        },
        setFragments(value) { currentMyFragments = value; }
      };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { createHarness } = await import(`data:text/javascript;base64,${Buffer.from(harness).toString('base64')}`);
  const hand = ['ally1', 'ally3', 'spell2', 'equip2', 'env2', 'ally3', 'free', 'trick', 'legacyTrick', 'ally6'];
  const ui = createHarness({}, cards);
  const glowing = () => ui.render(hand).filter(card => card.classes.has('is-playable')).map(card => card.id);
  assert.deepEqual(glowing(), ['ally1', 'ally3', 'spell2', 'equip2', 'env2', 'ally3', 'free']);
  ui.setFragments(2);
  assert.deepEqual(glowing(), ['ally1', 'spell2', 'equip2', 'env2', 'free']);
  ui.setFragments(0);
  assert.deepEqual(glowing(), ['free'], 'Spending fragments removes every unaffordable highlight');
  const selected = ui.render(hand).find(card => card.id === 'ally3');
  assert.ok(selected.classes.has('is-selected') && !selected.classes.has('is-playable'),
    'Selection must not imply affordability');
  ui.setFragments(5);
  assert.equal(glowing().length, 7, 'Recovering fragments restores all eligible highlights');
  assert.deepEqual(ui.render(hand).map(card => card.id), hand, 'Keep duplicates, order and all existing click handlers');
  assert.ok(ui.render(hand).every(card => typeof card.onclick === 'function'));
  assert.ok(ui.render(hand, false).every(card => !card.classes.has('is-playable')), 'Never highlight hidden opponent cards');
  scenarios += 8;

  for (const options of [{ isMyTurn: false }, { isSpectator: true }, { isMatchFinished: true },
    ...['INITIAL', 'COMBAT', 'END', 'MULLIGAN'].map(currentPhase => ({ currentPhase })), { fragments: NaN }]) {
    const inactive = createHarness(options, cards);
    assert.ok(hand.every(id => !inactive.eligible(id)), 'Highlight only during an active own preparation');
    scenarios++;
  }
  for (const id of ['trick', 'trickAlias', 'legacyTrick', 'legacyCounter', 'unknown']) {
    assert.equal(ui.eligible(id), false, 'Reactive or unknown cards must not look freely playable');
    scenarios++;
  }
  for (const id of ['missingCost', 'invalidCost']) {
    assert.equal(createHarness({ fragments: 0 }, cards).eligible(id), false);
    assert.equal(createHarness({ fragments: 1 }, cards).eligible(id), true, 'Match the existing server fallback cost');
    scenarios++;
  }
  for (const [id, options] of [
    ['destroyEnv', { currentEnemyEnv: 'env2' }],
    ['destroyEquip', { currentEnemySupport: ['equip2'] }],
    ['destroyAlly', { currentEnemyField: ['ally1'] }]
  ]) {
    assert.equal(ui.eligible(id), false);
    assert.equal(createHarness(options, cards).eligible(id), true);
    scenarios++;
  }
  const full = Array(5).fill('ally1');
  assert.equal(createHarness({ currentMyField: full, summonedBySide: { you: new Set([0, 1, 2, 3, 4]) } }, cards).eligible('ally1'), false);
  assert.equal(createHarness({ currentMyField: full, summonedBySide: { you: new Set([1, 2, 3, 4]) } }, cards).eligible('ally1'), true,
    'Preserve the option to replace an ally from a previous turn');
  assert.equal(createHarness({ currentMySupport: full }, cards).eligible('equip2'), false);
  assert.equal(createHarness({ currentMySupport: full }, cards).eligible('spell2'), true,
    'Resolved spells do not occupy a support slot');
  assert.equal(createHarness({ currentMyLeader: '' }, cards).eligible('equip2'), false);
  scenarios += 5;
}
console.log(`Hand playability: ${scenarios} JS/TS scenarios passed (all affordable cards, spending, zero cost, reactive tricks, turn/phase and entry conditions).`);
