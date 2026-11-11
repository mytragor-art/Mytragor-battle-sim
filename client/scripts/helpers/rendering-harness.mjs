import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.classes = new Set();
    this.sourceAssignments = 0;
    this.moves = 0;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, enabled = !this.classes.has(name)) => {
        enabled ? this.classes.add(name) : this.classes.delete(name);
        return enabled;
      }
    };
  }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get src() { return this.getAttribute('src'); }
  set src(value) { this.sourceAssignments++; this.setAttribute('src', value); }
  get parentElement() { return this.parentNode || null; }
  get nextElementSibling() {
    return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  appendChild(child) { return this.insertBefore(child, null); }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  insertBefore(child, reference) {
    child.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    assert.ok(index >= 0);
    this.children.splice(index, 0, child);
    child.parentNode = this;
    child.moves++;
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  set innerHTML(value) {
    for (const child of [...this.children]) child.remove();
    if (value) {
      assert.match(value, /opacity/);
      this.appendChild(new Element());
    }
  }
  addEventListener() {}
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const [tag, ...classes] = selector.split('.');
    return (!tag || this.tagName === tag.toUpperCase()) && classes.every(name => this.classes.has(name));
  }
  querySelectorAll(selector) {
    const results = new Set();
    for (const group of selector.split(',').map(value => value.trim())) {
      const direct = group.startsWith(':scope > ');
      const [first, ...rest] = (direct ? group.slice(9) : group).split(/\s+/);
      const descendants = direct ? this.children : this.children.flatMap(child => [child, ...child.descendants()]);
      for (const child of descendants.filter(child => child.matches(first))) {
        if (rest.length) child.querySelectorAll(rest.join(' ')).forEach(match => results.add(match));
        else results.add(child);
      }
    }
    return [...results];
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export async function createRenderingHarness(extension, options = {}, cards = {}) {
  const source = await readFile(new URL(`../../src/pages/game.${extension}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`game.${extension}`, source, ts.ScriptTarget.Latest, true);
  const names = ['normalizeKind', 'getCardKind', 'getFirstEmptyFieldPos', 'canHighlightHandCard',
    'asAssetPath', 'asThumbnailAssetPath', 'setThumbnailSource', 'buildHandCard', 'reconcileChildren',
    'syncBoardCard', 'renderSideHand', 'renderLane', 'renderLeaderSlot', 'renderEnvSlot',
    'renderDeckSlot', 'renderVisiblePileSlot', 'renderFragments', 'renderPileModal', 'pileLabel'];
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length, 'Exercise the actual JS/TS renderers');
  const elements = new Map();
  const calls = { animations: [], ghosts: [], clicks: [], hovered: [], inspect: [], layouts: [] };
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => elements.get(id) || null
  };
  const harness = ts.transpileModule(`
    export function createHarness(options, cards, document, calls) {
      const { isSpectator = false, isMatchFinished = false, isMyTurn = true, currentPhase = 'PREP',
        currentMyField = [], currentEnemyField = [], currentMySupport = [], currentEnemySupport = [],
        currentMyLeader = 'leader', currentMyEnv = null, currentEnemyEnv = null,
        summonedBySide = { you: new Set() } } = options;
      let selectedHandCardId = options.selectedHandCardId ?? 'ally3';
      let currentMyFragments = options.fragments ?? 5;
      const resolveCard = id => cards[id];
      const ASSET_CACHE_VERSION = 'test', CARD_BACK_ASSET = 'back.png';
      const previousHandCards = {}, previousLaneCards = {};
      const fieldChoices = { active: false }, view = {};
      const room = null;
      const cardBackAssetForSide = side => options.sleeves?.[side] || 'back.png';
      const setInspector = target => calls.inspect.push(target);
      const setHoveredInspector = target => calls.hovered.push(target);
      const tryPlayCard = id => calls.clicks.push(id);
      const queueHandStackLayout = id => calls.layouts.push(id);
      const animateEl = (element, name) => { calls.animations.push({ element, name }); element.classList.add(name); };
      const getNewHandEntryFlags = (entries, previous) => {
        const remaining = previous.slice();
        return entries.map(id => {
          const index = remaining.indexOf(id);
          if (index < 0) return true;
          remaining.splice(index, 1);
          return false;
        });
      };
      const appendBadge = (card, className, value) => {
        const badge = document.createElement('div');
        badge.className = className;
        badge.value = value;
        card.appendChild(badge);
      };
      const appendCostBadge = (card, cost) => appendBadge(card, 'costTag', cost);
      const appendBloodTag = (card, marks) => marks && appendBadge(card, 'markerTag', marks);
      const appendVitalTag = appendBloodTag, appendSpiderTag = appendBloodTag;
      const appendAllyStatsBar = (card, value) => appendBadge(card, 'allyStatsRow', value);
      const appendChosenStatsBar = appendAllyStatsBar;
      const appendEquipAttachTag = (card, side, index) => {
        if (options.equips) appendBadge(card, 'equipAttachTag', options.equips);
      };
      const appendSupportCounterTag = (card, value) => value && appendBadge(card, 'equipAttachTag', value);
      const attachMobilePreviewGesture = () => {};
      const bindMobileCardInspect = (element, target) => { element.inspectTarget = target; };
      const buildBackCard = side => {
        const back = document.createElement('div');
        back.className = 'card handCard slotCard slotCardBack';
        const image = document.createElement('img');
        image.className = 'slotCardImg';
        setThumbnailSource(image, cardBackAssetForSide(side));
        back.appendChild(image);
        return back;
      };
      const clearAttackTargetHover = () => {};
      const isMobileGameplay = () => false;
      const consumeLanePileFlight = () => options.consumeFlight || false;
      const spawnDeathGhost = (slot, card) => calls.ghosts.push(card);
      const tappedBySide = { you: new Set(), ai: new Set() };
      const untapPulseBySide = { you: false, ai: false };
      const justUntappedBySide = { you: new Set(), ai: new Set() };
      const justUntappedLeaderBySide = { you: false, ai: false };
      const canSelectCombatAttacker = () => !!options.attacker;
      const canSelectCombatTarget = () => !!options.target;
      const getDisplayedFieldMaxHp = () => options.maxHp || 5;
      const getFieldAttackValue = () => options.attack || 2;
      const getFieldResistanceValue = () => options.resistance || 0;
      const getFieldBloodMarksForSide = () => options.blood || 0;
      const getFieldVitalMarksForSide = () => options.vital || 0;
      const getSupportCounterForSide = () => options.counter || 0;
      const laneForCard = id => cards[id]?.kind === 'env' ? 'env' : 'field';
      const bindAttackTargetHover = () => {};
      const selectedAttackerPos = null;
      let currentMyLeaderTapped = false, currentEnemyLeaderTapped = false;
      const hasManualLeaderPower = () => true;
      const canUseLeaderPower = () => !!options.leaderReady;
      const setChosenReady = (card, ready) => card.classList.toggle('chosenReady', ready);
      const getLeaderMaxHpValue = () => 20;
      const getLeaderEquipResistanceBonus = () => options.resistance || 0;
      const currentMyLeaderVitalMarks = 0, currentEnemyLeaderVitalMarks = 0;
      const currentMyLeaderSpiderMarks = 0, currentEnemyLeaderSpiderMarks = 0;
      let activePileSide = 'you', activePileWhich = 'grave';
      const pileCards = () => options.pile || [];
      ${functions.map(node => node.getText(parsed)).join('\n')}
      return {
        eligible: canHighlightHandCard, renderSideHand, renderLane, renderLeaderSlot, renderEnvSlot,
        renderDeckSlot, renderVisiblePileSlot, renderFragments, renderPileModal, setThumbnailSource,
        render(hand, selectable = true) {
          const id = selectable ? 'youHand' : 'aiHand';
          renderSideHand(id, hand, selectable);
          return document.getElementById(id).children;
        },
        setFragments(value) { currentMyFragments = value; },
        setLeaderTapped(value) { currentMyLeaderTapped = value; },
        setPile(side, which) { activePileSide = side; activePileWhich = which; },
        tappedBySide, untapPulseBySide, justUntappedBySide, justUntappedLeaderBySide
      };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { createHarness } = await import(`data:text/javascript;base64,${Buffer.from(harness).toString('base64')}`);
  const ui = createHarness(options, cards, document, calls);
  const add = (id, tag = 'div') => {
    const element = document.createElement(tag);
    element.id = id;
    elements.set(id, element);
    return element;
  };
  add('youHand'); add('aiHand'); add('enemyHandCount');
  return { ...ui, elements, calls, add };
}
