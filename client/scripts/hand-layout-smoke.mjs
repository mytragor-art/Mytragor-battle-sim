import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

class Element {
  constructor() {
    this.properties = new Map();
    this.style = {
      setProperty: (name, value) => this.properties.set(name, value),
      removeProperty: name => this.properties.delete(name)
    };
    this.classList = { remove() {} };
  }
  closest() { return this.arena || null; }
}

globalThis.getComputedStyle = () => ({ paddingLeft: '24px', paddingRight: '24px', paddingTop: '24px', columnGap: '6px' });
let touch = false;
globalThis.window = { matchMedia: query => ({ matches: query.includes('coarse') ? touch : !touch }) };
let scenarios = 0;
for (const extension of ['js', 'ts']) {
  let source = await readFile(new URL(`../src/ui/handLayout.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { layoutPlayerHand, layoutOpponentHand } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const width of [180, 320, 800]) {
    for (const count of [0, 1, 3, 7, 12, 20, 60]) {
      const container = new Element();
      container.clientWidth = width;
      const cards = Array.from({ length: count }, () => ({ offsetWidth: 40 }));
      container.querySelectorAll = () => cards;
      layoutOpponentHand(container);
      const overlap = parseFloat(container.properties.get('--opponent-hand-overlap'));
      assert.ok(Number.isFinite(overlap) && overlap >= 0 && overlap <= 32);
      if (count > 1) {
        const spread = count * 40 - (count - 1) * overlap;
        assert.ok(spread <= width - 48 + 0.001 || overlap === 32,
          'Fit the opponent hand or keep each back visible and allow scrolling');
      } else {
        assert.equal(overlap, 0);
      }
      assert.equal(cards.length, count, 'Do not remove or reveal cards to fit the hand');
      scenarios++;
    }
  }
  for (const scale of [0.8, 1]) {
    for (const fragmentBottom of [420, 470, 600]) {
      const container = new Element();
      container.clientWidth = container.offsetWidth = 500;
      container.getBoundingClientRect = () => ({ width: 500 * scale, top: 400 * scale });
      const card = new Element();
      card.offsetWidth = 90;
      card.offsetHeight = 126;
      container.querySelectorAll = () => [card];
      container.arena = {
        querySelector: () => ({ getBoundingClientRect: () => ({ bottom: fragmentBottom * scale, height: 100 * scale }) })
      };
      touch = false;
      layoutPlayerHand(container);
      const expected = Math.min(126 * 0.4, Math.max(0, (fragmentBottom * scale - Math.min(20, 25 * scale) - 400 * scale) / scale - 24));
      assert.equal(parseFloat(container.properties.get('--player-hand-rest')), expected);
      assert.ok(expected <= card.offsetHeight * 0.4, 'Keep most of the hand visible instead of hiding it below the viewport');
      touch = true;
      layoutPlayerHand(container);
      assert.equal(container.properties.has('--player-hand-rest'), false, 'Preserve the mobile hand position');
      scenarios++;
    }
  }
  for (const width of [240, 390, 800]) {
    for (touch of [false, true]) {
      for (const scale of [0.8, 1]) {
        for (const count of [0, 1, 3, 7, 12, 20, 60]) {
          const container = new Element();
          container.clientWidth = container.offsetWidth = width;
          container.getBoundingClientRect = () => ({ width: width * scale });
          let clicks = 0;
          const cards = Array.from({ length: count }, (_, index) => {
            const card = new Element();
            card.offsetWidth = 90;
            card.dataset = { cardId: `card-${index}` };
            card.onclick = () => clicks++;
            return card;
          });
          container.querySelectorAll = () => cards;
          const originalCards = cards.slice();
          layoutPlayerHand(container);
          const overlap = parseFloat(container.properties.get('--player-hand-overlap'));
          assert.ok(Number.isFinite(overlap) && overlap >= 0);
          assert.equal(container.properties.get('--player-hand-count'), String(count));
          const maxOverlap = Math.max(0, 90 - (touch ? 44 : 36) / scale);
          assert.ok(overlap <= maxOverlap + 0.001, 'Keep a selectable exposed area, even on scaled screens');
          if (count > 1) {
            const spreadWidth = count * 90 + (count - 1) * (6 - overlap);
            assert.ok(spreadWidth <= width - 48 + 0.001 || Math.abs(overlap - maxOverlap) < 0.001,
              'Fit the available width or preserve readability and allow scrolling');
          } else {
            assert.equal(overlap, 0);
          }
          cards.forEach((card, index) => {
            assert.equal(card, originalCards[index], 'Keep original DOM order and identity');
            assert.equal(card.dataset.cardId, `card-${index}`);
            assert.equal(card.properties.get('--player-hand-order'), String(index));
            assert.ok(Math.abs(parseFloat(card.properties.get('--player-hand-angle'))) <= 4);
            assert.ok(parseFloat(card.properties.get('--player-hand-arc')) <= 8);
            card.onclick();
          });
          assert.equal(clicks, count, 'Keep existing interaction handlers');
          if (count > 1) {
            assert.equal(cards[0].properties.get('--player-hand-angle'), '-4deg');
            assert.equal(cards.at(-1).properties.get('--player-hand-angle'), '4deg');
          }
          container.querySelectorAll = () => [];
          layoutPlayerHand(container);
          assert.equal(container.properties.get('--player-hand-overlap'), '0px');
          assert.equal(container.properties.get('--player-hand-count'), '0');
          scenarios++;
        }
      }
    }
  }
}
for (const extension of ['js', 'ts']) {
  const root = new Element();
  const stage = new Element();
  stage.offsetWidth = 1000;
  stage.offsetHeight = 800;
  const board = { offsetWidth: 1000, offsetHeight: 1050 };
  let bounds;
  const wrap = { getBoundingClientRect: () => bounds };
  const observed = [];
  globalThis.document = {
    documentElement: root,
    querySelector: selector => selector === '.boardStage' ? stage : selector === '.boardWrap' ? wrap : board
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: name => ({ '--arena-w': '1000', '--arena-h': '800', '--cardW-base': '90', '--cardH-base': '126' })[name] });
  globalThis.window = {
    matchMedia: query => ({ matches: query.includes('orientation') ? window.innerHeight > window.innerWidth : window.innerWidth <= 980 }),
    addEventListener() {}
  };
  globalThis.ResizeObserver = class { observe(element) { observed.push(element); } };
  let source = await readFile(new URL(`../src/ui/boardScale.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { setupBoardScale } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${extension}`);
  for (const [width, height, minimum] of [[1200, 750, 0.42], [390, 520, 0.34], [458, 290, 0.32]]) {
    bounds = { width, height };
    window.innerWidth = width;
    window.innerHeight = height;
    setupBoardScale();
    const scale = Number(root.properties.get('--scale'));
    assert.ok(scale * board.offsetWidth <= width - 8 + 0.001, 'Fit the horizontal playmat bounds');
    assert.ok(scale >= minimum, 'Preserve the original field readability floor, including short landscape screens');
    assert.equal(scale, Math.max(minimum, Math.min((width - 8) / 1000, (height - 14) / 1050, 1.2)));
    assert.ok(observed.includes(wrap), 'Recalculate when the available board space changes');
    scenarios++;
  }
}
for (const extension of ['js', 'ts']) {
  const source = await readFile(new URL(`../src/ui/mobileCardInspect.${extension}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`inspect.${extension}`, source, ts.ScriptTarget.Latest, true);
  let bind;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'bind') bind = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(bind, 'Exercise the actual mobile inspection gesture bindings');
  const harness = ts.transpileModule(
    `export const createBind = (window, isMobileInspectEnabled, showInfo) => {
      const LONG_PRESS_MS = 650;
      const MOVE_CANCEL_PX = 10;
      return ${bind.getText(parsed)};
    };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
  ).outputText;
  const { createBind } = await import(`data:text/javascript;base64,${Buffer.from(harness).toString('base64')}`);
  for (const gesture of ['tap', 'hold', 'scroll', 'uncancelable-hold', 'desktop']) {
    const listeners = new Map();
    const timers = new Map();
    let inspected = 0;
    const fakeWindow = {
      setTimeout: callback => { timers.set(1, callback); return 1; },
      clearTimeout: id => timers.delete(id),
      navigator: {}
    };
    const element = { addEventListener: (type, handler, options) => listeners.set(type, { handler, options }) };
    createBind(fakeWindow, () => gesture !== 'desktop', () => inspected++)(element, () => ({ id: 'card' }));
    listeners.get('touchstart').handler({ touches: [{ identifier: 1, clientX: 0, clientY: 0 }] });
    if (gesture === 'scroll') listeners.get('touchmove').handler({ touches: [{ identifier: 1, clientX: 30, clientY: 0 }] });
    if (gesture.endsWith('hold')) timers.get(1)();
    let prevented = false;
    listeners.get('touchend').handler({
      cancelable: gesture !== 'uncancelable-hold',
      preventDefault: () => { prevented = true; }
    });
    assert.equal(prevented, gesture === 'hold', 'Suppress only the compatibility click after long press');
    assert.equal(inspected, gesture.endsWith('hold') ? 1 : 0, 'Taps and scrolling must not open inspection');
    assert.equal(timers.size, 0, 'Release or scrolling cancels the long-press timer');
    assert.equal(listeners.get('touchend').options.passive, false, 'Allow canceling the retargeted compatibility click');
    scenarios++;
  }
}
console.log(`Hand layout: ${scenarios} JS/TS scenarios passed (adaptive overlap, touch targets, board fitting, mobile gestures and unchanged card actions).`);
