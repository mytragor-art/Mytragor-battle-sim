import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

class Element {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.attributes = new Map();
    this.classes = new Set();
    this.listeners = new Map();
    this.style = {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
      getPropertyValue(name) { return this[name] || ''; }
    };
    this.dataset = {};
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      contains: name => this.classes.has(name)
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; }
  replaceChildren(...children) { this.children = children; }
  contains(child) { return this === child || this.children.some(element => element.contains(child)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector() { return this.children[0] || null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  getBoundingClientRect() {
    return this.rect || { left: 400, right: 480, top: 200, bottom: 310, width: 80, height: 110 };
  }
}
globalThis.Node = Element;
globalThis.KeyboardEvent = class { constructor(key) { this.key = key; } };
const windowListeners = new Map();
globalThis.window = {
  innerWidth: 1280, innerHeight: 900,
  addEventListener: (type, callback) => windowListeners.set(type, callback),
  removeEventListener: type => windowListeners.delete(type)
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
let scenarios = 0;
for (const extension of ['js', 'ts']) {
  let helper = await readFile(new URL(`../src/ui/fieldChoices.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') helper = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { canChooseOnField, createFieldChoiceController } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
  const source = await readFile(new URL(`../src/pages/game.${extension}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(`game.${extension}`, source, ts.ScriptTarget.Latest, true);
  const choiceFunction = parsed.statements.find(node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'showEffectChoiceModal');
  assert.ok(choiceFunction.getText(parsed).includes('pendingFieldChoicePayload = { ...payload, options }'),
    'Choices arriving before the state patch must be retried');
  assert.equal((source.match(/refreshFieldChoice\(\);/g) || []).length, 2, 'Both state sync paths retry field choices');
  const actionNames = ['btnLeaderPower', 'btnAttack', 'btnTargetLeader', 'btnNextPhase', 'btnEndTurn'];
  const actionBindings = parsed.statements.filter(node => ts.isIfStatement(node)
    && actionNames.some(name => node.expression.getText(parsed) === `view.${name}`));
  assert.equal(actionBindings.length, actionNames.length);
  const actionHarness = ts.transpileModule(`
    export function createActions(fieldChoices) {
      const view = Object.fromEntries(${JSON.stringify(actionNames)}.map(name => [name, {}]));
      const calls = [], room = { send: type => calls.push(type) };
      const isSpectator = false, isMyTurn = true, currentPhase = 'COMBAT', selectedAttackerPos = 0;
      let selectedTargetType = 'ally', selectedTargetPos = 2;
      const canUseLeaderPower = () => true;
      const animateChosenPowerActivation = () => calls.push('powerAnimation');
      const resolveSelectedBoardAttack = () => calls.push('attack');
      ${actionBindings.map(node => node.getText(parsed)).join('\n')}
      return { run: () => Object.values(view).forEach(button => button.onclick()), calls, target: () => selectedTargetType };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { createActions } = await import(`data:text/javascript;base64,${Buffer.from(actionHarness).toString('base64')}`);
  const actionState = { active: true };
  const actionTest = createActions(actionState);
  actionTest.run();
  assert.deepEqual(actionTest.calls, []);
  assert.equal(actionTest.target(), 'ally');
  actionState.active = false;
  actionTest.run();
  assert.deepEqual(actionTest.calls, ['powerAnimation', 'leader_power', 'attack', 'next_phase', 'end_turn']);
  assert.equal(actionTest.target(), 'leader');
  scenarios += 2;
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['sideFromServerSlot', 'resolveChoiceHighlightElement'].includes(node.name?.text));
  assert.equal(functions.length, 2);
  const harness = ts.transpileModule(`
    export function createResolver(slot, elements) {
      const currentMyLeader = 'my-leader', currentEnemyLeader = 'enemy-leader';
      const document = { getElementById: id => elements.get(id) || null };
      ${functions.map(node => node.getText(parsed)).join('\n')}
      return resolveChoiceHighlightElement;
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { createResolver } = await import(`data:text/javascript;base64,${Buffer.from(harness).toString('base64')}`);
  const elements = new Map(['board', 'fieldChoiceBar', 'fieldChoiceTitle', 'fieldChoiceHint', 'fieldChoiceActions', 'fieldChoiceCountdown', 'cardChoiceModal', 'cardChoiceTitle', 'cardChoiceGrid']
    .map(id => [id, new Element(id)]));
  const options = [];
  for (const [side, serverSide] of [['you', 'p1'], ['ai', 'p2']]) {
    for (let pos = 0; pos < 5; pos++) {
      const element = new Element(`${side}-ally-${pos}`);
      const card = element.appendChild(new Element());
      card.dataset.cardId = `${side}-card-${pos}`;
      elements.set(element.id, element);
      options.push({ id: `${side}-${pos}`, side: serverSide, lane: 'field', pos, cardId: card.dataset.cardId });
    }
    const element = new Element(`${side}-leader`);
    const card = element.appendChild(new Element());
    card.dataset.cardId = side === 'you' ? 'my-leader' : 'enemy-leader';
    elements.set(element.id, element);
    options.push({ id: `${side}-leader`, side: serverSide, lane: 'env', cardId: card.dataset.cardId });
  }
  globalThis.document = { getElementById: id => elements.get(id) || null, createElement: () => new Element() };
  const resolve = createResolver('p1', elements);
  const field = options[0], skip = { id: 'skip', label: 'Não usar' };
  for (const list of [[field], [field, skip], [field, { ...skip, side: 'p1' }], options, options.slice(0, 9)]) {
    assert.equal(canChooseOnField(list, resolve), true, 'Field selection must support all 12 Mãos Flamejantes targets');
    scenarios++;
  }
  for (const list of [[], [skip], [field, field], [{ ...field, lane: 'grave' }], [{ ...field, lane: 'deck' }],
    [{ ...field, lane: 'hand' }], [{ ...field, cardId: 'stale-card' }], [field, { ...field, lane: 'grave' }]]) {
    assert.equal(canChooseOnField(list, resolve), false, 'Ambiguous choices and off-board cards keep the centered modal');
    scenarios++;
  }
  assert.equal(resolve(options[5]), elements.get('you-leader'), 'Server env references may mean a leader');
  assert.equal(createResolver('p2', elements)({ ...options[0], cardId: 'ai-card-0' }), elements.get('ai-ally-0'));
  scenarios += 2;
  const sent = [];
  let canceled = 0;
  let controller;
  controller = createFieldChoiceController(resolve, id => { sent.push(id); controller.hide(); },
    () => { canceled++; controller.hide(); });
  const target = elements.get('you-ally-0');
  const bar = elements.get('fieldChoiceBar');
  bar.rect = { left: 0, right: 520, top: 0, bottom: 90, width: 520, height: 90 };
  target.setAttribute('role', 'group');
  target.setAttribute('tabindex', '-1');
  const dispatch = (element, key = null) => {
    const event = key ? new KeyboardEvent(key) : {};
    Object.assign(event, { target: element, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
    elements.get('board').listeners.get(key ? 'keydown' : 'click')(event);
    return event;
  };
  controller.show({ options });
  assert.equal(bar.getAttribute('data-choice-kind'), 'target');
  assert.equal(target.getAttribute('data-choice-kind'), 'target');
  assert.equal(bar.style.top, '322px', 'Place the prompt just below the cards instead of at the top of the screen');
  assert.equal(controller.active, true);
  assert.equal(elements.get('fieldChoiceBar').hidden, false);
  const invalid = dispatch(new Element());
  assert.ok(invalid.prevented && invalid.stopped && !sent.length, 'Invalid clicks must not fall through to combat handlers');
  dispatch(target.children[0]);
  assert.deepEqual(sent, ['you-0']);
  assert.equal(controller.active, false);
  assert.equal(target.getAttribute('role'), 'group');
  assert.equal(target.getAttribute('tabindex'), '-1');
  assert.equal(target.classes.has('choiceBoardHighlight'), false);
  assert.equal(target.getAttribute('data-choice-kind'), null, 'Remove the operation color after submitting');
  assert.equal(windowListeners.size, 0, 'Remove positioning listeners when the choice closes');
  scenarios += 7;
  for (const kind of ['activation', 'replacement']) {
    controller.show({ options: [field], choiceKind: kind });
    assert.equal(target.getAttribute('data-choice-kind'), kind);
    assert.equal(bar.getAttribute('data-choice-kind'), kind);
    assert.ok(elements.get('fieldChoiceHint').textContent.startsWith(kind === 'activation' ? 'Ativar efeito' : 'Substituir aliado'));
    controller.refresh();
    assert.equal(target.getAttribute('data-choice-kind'), kind, 'Preserve the operation color after state sync');
    target.rect = { left: 400, right: 480, top: 780, bottom: 890, width: 80, height: 110 };
    windowListeners.get('resize')();
    assert.equal(bar.style.top, '678px', 'Move above low cards instead of covering them');
    controller.hide();
    assert.equal(target.getAttribute('data-choice-kind'), null);
    assert.equal(bar.getAttribute('data-choice-kind'), null);
    target.rect = null;
    scenarios++;
  }
  const board = elements.get('board');
  board.querySelector = () => ({ getBoundingClientRect: () => ({ top: 450, bottom: 500 }) });
  const upper = elements.get('ai-ally-0');
  upper.rect = { left: 400, right: 480, top: 100, bottom: 210, width: 80, height: 110 };
  target.rect = { left: 400, right: 480, top: 700, bottom: 810, width: 80, height: 110 };
  controller.show({ options: [field, options[6]] });
  assert.equal(bar.style.top, '430px', 'Keep choices spanning both sides near the central divider');
  controller.hide();
  board.querySelector = Element.prototype.querySelector;
  target.rect = upper.rect = null;
  window.innerWidth = 390;
  bar.rect = { left: 0, right: 374, top: 0, bottom: 90, width: 374, height: 90 };
  controller.show({ options: [field] });
  assert.equal(bar.style.left, '195px', 'Keep the prompt inside narrow viewports');
  controller.hide();
  window.innerWidth = 1280;
  bar.rect = { left: 0, right: 520, top: 0, bottom: 90, width: 520, height: 90 };
  scenarios += 2;
  controller.show({ options: options.slice(0, 3), multiSelect: true, minSelections: 1, maxSelections: 2 });
  const actions = elements.get('fieldChoiceActions');
  const confirm = actions.children.find(button => button.className === 'btn primary');
  assert.equal(confirm.disabled, true);
  dispatch(target, 'Enter');
  dispatch(elements.get('you-ally-1'), ' ');
  dispatch(elements.get('you-ally-2'));
  assert.equal(confirm.textContent, 'Confirmar (2)');
  controller.refresh();
  assert.ok(target.classes.has('choiceBoardSelected'), 'State sync preserves selected targets');
  confirm.onclick();
  assert.equal(sent.at(-1), 'you-0|you-1');
  assert.equal(target.classes.has('choiceBoardSelected'), false);
  scenarios += 5;
  controller.show({ options: [field, skip], allowCancel: false });
  assert.equal(actions.children.some(button => button.textContent === 'Cancelar'), false);
  const oldSkip = actions.children.find(button => button.textContent === 'Não usar');
  oldSkip.onclick();
  assert.equal(sent.at(-1), 'skip');
  controller.show({ options: [field] });
  const count = sent.length;
  oldSkip.onclick();
  assert.equal(sent.length, count, 'Detached controls cannot submit a previous choice');
  actions.children.find(button => button.textContent === 'Cancelar').onclick();
  assert.equal(canceled, 1);
  controller.show({ options: [field, { ...options[1], disabled: true }] });
  dispatch(elements.get('you-ally-1'));
  assert.equal(sent.length, count, 'Disabled targets cannot be selected');
  controller.hide();
  scenarios += 5;
  const equips = [];
  for (const [side, serverSide] of [['you', 'p1'], ['ai', 'p2']]) {
    for (let pos = 0; pos < 5; pos++) {
      const element = new Element(`${side}-support-${pos}`);
      element.classList.add('attachedEquipment');
      element.style.setProperty('--equipment-column', '1');
      const card = element.appendChild(new Element());
      card.dataset.cardId = 'Manto de Couro';
      elements.set(element.id, element);
      equips.push({ id: `equip-${serverSide}-${pos}`, side: serverSide, lane: 'support', pos, cardId: card.dataset.cardId });
    }
  }
  controller.show({ options: equips });
  for (const option of equips) {
    const element = resolve(option);
    assert.ok(element.classList.contains('choiceEquipmentExpanded'));
    assert.equal(element.style.getPropertyValue('--choice-equipment-column'), String(option.pos + 1));
    assert.equal(element.style.getPropertyValue('--equipment-column'), '1', 'Logical attachment remains unchanged');
    scenarios++;
  }
  controller.refresh();
  assert.equal(elements.get('ai-support-4').style.getPropertyValue('--choice-equipment-column'), '5');
  dispatch(elements.get('ai-support-4').children[0]);
  assert.equal(sent.at(-1), 'equip-p2-4');
  for (const option of equips) {
    const element = resolve(option);
    assert.equal(element.classList.contains('choiceEquipmentExpanded'), false);
    assert.equal(element.style.getPropertyValue('--choice-equipment-column'), '');
  }
  scenarios += 3;
  controller.show({ options: [field, ...equips] });
  assert.ok(target.classList.contains('choiceBoardHighlight'), 'Mixed displacement targets retain characters');
  assert.equal(target.classList.contains('choiceEquipmentExpanded'), false);
  actions.children.find(button => button.textContent === 'Cancelar').onclick();
  assert.equal(elements.get('you-support-0').classList.contains('choiceEquipmentExpanded'), false);
  scenarios += 2;
  controller.show({ options: equips });
  const oldEquipment = elements.get('you-support-0');
  const replacement = new Element(oldEquipment.id);
  replacement.classList.add('attachedEquipment');
  replacement.appendChild(new Element()).dataset.cardId = 'Manto de Couro';
  elements.set(replacement.id, replacement);
  controller.refresh();
  assert.equal(oldEquipment.classList.contains('choiceEquipmentExpanded'), false);
  assert.equal(replacement.classList.contains('choiceEquipmentExpanded'), true, 'State sync expands the new original slot');
  controller.hide();
  assert.equal(replacement.classList.contains('choiceEquipmentExpanded'), false);
  assert.equal(canChooseOnField([{ ...equips[0], lane: 'hand' }], resolve), false,
    'An identical copy at the same hand/support index must keep the modal');
  scenarios += 4;
  const refreshFunction = parsed.statements.find(node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'refreshFieldChoice');
  const refreshHarness = ts.transpileModule(`
    export function createRefresh(payload, fieldChoices, canChooseOnField, resolveChoiceHighlightElement) {
      let pendingFieldChoicePayload = payload, activeChoiceId = 'sync-choice', activeChoiceIsMinimized = true;
      const clearChoiceBoardHighlights = () => {}, hideChoiceRestoreDock = () => {};
      ${refreshFunction.getText(parsed)}
      return { refresh: refreshFieldChoice, pending: () => pendingFieldChoicePayload };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { createRefresh } = await import(`data:text/javascript;base64,${Buffer.from(refreshHarness).toString('base64')}`);
  const modal = elements.get('cardChoiceModal');
  modal.style.display = 'flex';
  target.children[0].dataset.cardId = 'previous-occupant';
  const promotion = createRefresh({ options: [field, ...equips] }, controller, canChooseOnField, resolve);
  promotion.refresh();
  assert.equal(controller.active, false);
  assert.equal(modal.style.display, 'flex', 'Unrendered targets cannot submit through the field');
  target.children[0].dataset.cardId = field.cardId;
  promotion.refresh();
  assert.equal(controller.active, true, 'An entering Executor becomes selectable after its state patch');
  assert.equal(modal.style.display, 'none');
  assert.equal(promotion.pending(), null);
  assert.ok(replacement.classList.contains('choiceEquipmentExpanded'));
  controller.hide();
  const offBoard = createRefresh({ options: [{ ...equips[0], lane: 'hand' }] }, controller, canChooseOnField, resolve);
  offBoard.refresh();
  assert.equal(controller.active, false, 'A state patch cannot promote a hand choice to the field');
  scenarios += 7;
  const modalFunctions = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['showEffectChoiceModal', 'createChoiceDuelPanel', 'createCounteredCardPanel', 'buildChoiceAttackerSummary',
      'refreshFieldChoice', 'isNegativeChoiceOption', 'normalizeKind'].includes(node.name?.text));
  assert.equal(modalFunctions.length, 7);
  const modalHarness = ts.transpileModule(`
    export function createModal(fieldChoices, canChooseOnField, resolveChoiceHighlightElement, slot, width) {
      const window = { innerWidth: width };
      let pendingFieldChoicePayload = null, activeChoiceId = null, activeChoiceTitleText = '', activeChoiceIsMinimized = false;
      const calls = [], room = { send: (type, payload) => calls.push({ type, ...payload }) };
      const CARD_BACK_ASSET = 'back.png', asAssetPath = value => value;
      const resolveCard = id => ({ name: id, img: id + '.png' });
      const setThumbnailSource = (image, src) => { image.src = src; };
      const sideFromServerSlot = side => side === slot ? 'you' : 'ai';
      const getChoiceOptionVisual = option => ({ cardId: option.cardId, muted: false });
      const hideChoiceRestoreDock = () => {}, hideChoiceWaitingModal = () => {}, applyChoiceBoardHighlights = () => {};
      const clearChoiceBoardHighlights = () => {}, startCountdown = (...args) => calls.push({ countdown: args });
      const bindMobileCardInspect = () => {};
      const cardPreviewDetails = id => 'Full details: ' + id, setInspector = () => {};
      const hideCardChoiceModal = sendCancel => {
        if (sendCancel) room.send('effect_choice_submit', { choiceId: activeChoiceId, optionId: null });
        fieldChoices.hide();
        document.getElementById('cardChoiceModal').style.display = 'none';
      };
      ${modalFunctions.map(node => node.getText(parsed)).join('\n')}
      return { show: showEffectChoiceModal, refresh: refreshFieldChoice, calls,
        pending: () => pendingFieldChoicePayload };
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { createModal } = await import(`data:text/javascript;base64,${Buffer.from(modalHarness).toString('base64')}`);
  const descendants = element => [element, ...element.children.flatMap(descendants)];
  for (const width of [390, 1280]) {
    for (const slot of ['p1', 'p2']) {
      for (const target of ['Gladiador Ousado', 'Ranza, o Arqueiro das Trevas']) {
        const modalTest = createModal(controller, canChooseOnField, resolve, slot, width);
        const block = { ...field, id: 'block-0', label: 'Interpor' };
        const decline = { id: 'block-cancel', label: 'Não interpor', side: 'p1' };
        const payload = {
          choiceId: 'interpor-choice', title: 'Escolher aliado para interpor?', options: [block, decline],
          attackerId: 'Cão de Caça Feroz', attackerName: 'Cão de Caça Feroz', attackerAttack: 4,
          targetCardId: target, targetName: target, targetResistance: 2, targetHp: 6, targetMaxHp: 8,
          timeoutMs: 30000
        };
        assert.equal(canChooseOnField(payload.options, resolve), true, 'Reproduce Interpor as an eligible field choice');
        modalTest.show(payload);
        assert.equal(controller.active, false, 'Combat decisions must retain their context in the modal');
        assert.equal(modal.style.display, 'flex');
        assert.equal(modalTest.pending(), null, 'A later state patch must not hide combat context');
        modalTest.refresh();
        assert.equal(modal.style.display, 'flex');
        const grid = elements.get('cardChoiceGrid');
        const choices = grid.children[0].children[0];
        const panel = choices.children[0];
        const content = descendants(panel);
        for (const text of ['Combate Atual', 'Atacante', 'Alvo original', payload.attackerName, target,
          'ATK 4 x RES 2', 'Vida alvo 6/8']) {
          assert.ok(content.some(element => element.textContent === text), text);
        }
        assert.equal(content.filter(element => element.src).length, 2, 'Both combatant thumbnails are visible');
        assert.equal(modalTest.calls[0].countdown[2], 30000, 'Combat choices keep their timeout');
        for (const option of payload.options) {
          const button = descendants(choices).find(element => element.title === option.label);
          assert.ok(button, option.label);
          if (option.id === 'block-cancel') {
            assert.equal(descendants(button).some(element => element.src), false, 'Declining is an action, not a card');
            assert.ok(descendants(button).some(element => element.textContent === 'Manter o ataque no alvo original.'));
          }
          button.onclick();
          assert.deepEqual(modalTest.calls.at(-1), {
            type: 'effect_choice_submit', choiceId: payload.choiceId, optionId: option.id
          });
        }
        scenarios++;
      }
    }
  }
  const ordinaryChoice = createModal(controller, canChooseOnField, resolve, 'p1', 1280);
  ordinaryChoice.show({ choiceId: 'ordinary-choice', options: [field] });
  assert.equal(controller.active, true, 'Noncombat effects still use direct field selection');
  assert.equal(modal.style.display, 'none');
  controller.hide();
  scenarios++;
  const multi = createModal(controller, canChooseOnField, resolve, 'p1', 390);
  multi.show({ choiceId: 'modal-multi', options: [
    { id: 'grave-0', label: 'First card', cardId: 'first', lane: 'grave' },
    { id: 'grave-1', label: 'Second card', cardId: 'second', lane: 'grave' },
    { id: 'grave-2', label: 'Disabled card', cardId: 'third', lane: 'grave', disabled: true }
  ], multiSelect: true, minSelections: 1, maxSelections: 1, submitLabel: 'Deslocar' });
  let contents = descendants(elements.get('cardChoiceGrid'));
  const confirmModal = contents.find(element => element.className === 'btn primary choiceSubmit');
  const firstModal = contents.find(element => element.title === 'First card');
  const secondModal = contents.find(element => element.title === 'Second card');
  assert.equal(confirmModal.disabled, true);
  firstModal.onclick();
  assert.equal(firstModal.getAttribute('aria-pressed'), 'true');
  assert.equal(confirmModal.textContent, 'Deslocar (1)');
  secondModal.onclick();
  assert.equal(secondModal.getAttribute('aria-pressed'), 'false', 'Modal selection limits remain enforced');
  confirmModal.onclick();
  assert.deepEqual(multi.calls.at(-1), { type: 'effect_choice_submit', choiceId: 'modal-multi', optionId: 'grave-0' });
  scenarios++;
  const counter = createModal(controller, canChooseOnField, resolve, 'p1', 1280);
  counter.show({ choiceId: 'counter', activatedCardId: 'Mãos Flamejantes', options: [
    { id: 'counter-0', label: 'Ativar Interrupção Perfeita', description: 'Pagar 2 fragmentos.', cardId: 'Interrupção Perfeita', lane: 'hand' },
    { id: 'counter-no', label: 'Não ativar', description: 'Deixar a magia resolver.' }
  ] });
  contents = descendants(elements.get('cardChoiceGrid'));
  assert.equal(elements.get('cardChoiceGrid').children[0].children[0].children[0].className, 'choiceCounteredPanel');
  assert.ok(contents.some(element => element.textContent === 'Mãos Flamejantes'));
  assert.ok(contents.some(element => element.textContent === 'Pagar 2 fragmentos.'));
  assert.ok(contents.some(element => element.className === 'choicePreview'), 'Card details remain available without a permanent preview column');
  contents.find(element => element.title === 'Não ativar').onclick();
  assert.deepEqual(counter.calls.at(-1), { type: 'effect_choice_submit', choiceId: 'counter', optionId: 'counter-no' });
  scenarios++;
}
console.log(`Direct field choices: ${scenarios} JS/TS scenarios passed (12 characters, 10 equipment, IDs, keyboard, multiselect, cancel, state sync and cleanup).`);
