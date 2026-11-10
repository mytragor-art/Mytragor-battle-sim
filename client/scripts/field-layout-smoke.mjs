import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.classes = new Set();
    this.properties = new Map();
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    this.style = {
      setProperty: (name, value) => this.properties.set(name, value),
      removeProperty: name => this.properties.delete(name)
    };
  }
  closest() { return this.mainArea; }
  querySelector() { return this.card || null; }
}

globalThis.HTMLElement = Element;
const elements = new Map();
globalThis.document = { getElementById: id => elements.get(id) || null };
for (const extension of ['js', 'ts']) {
  let source = await readFile(new URL(`../src/ui/equipmentLayout.${extension}`, import.meta.url), 'utf8');
  if (extension === 'ts') source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const { layoutEquipment } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const side of ['you', 'ai']) {
    elements.clear();
    const mainArea = new Element();
    const zone = new Element();
    zone.mainArea = mainArea;
    zone.children = Array.from({ length: 5 }, () => new Element());
    elements.set(`${side}-support`, zone);
    for (const target of ['leader', ...Array.from({ length: 5 }, (_, i) => `ally-${i}`)]) {
      const carrier = new Element();
      carrier.card = new Element();
      elements.set(`${side}-${target}`, carrier);
    }
    let clicks = 0;
    const slots = zone.children.slice();
    slots.forEach((slot, index) => {
      slot.dataset.slot = String(index);
      slot.onclick = () => clicks++;
    });
    const cards = ['equip-a', 'equip-b', 'equip-c', 'spell', ''];
    const attachments = [0, 0, -1, -2, -2];
    const before = JSON.stringify({ cards, attachments });
    const update = () => layoutEquipment(side, cards, attachments, id => id.startsWith('equip-'));
    update();
    assert.equal(mainArea.properties.get('--equipment-depth'), '2');
    assert.ok(zone.classes.has('hasLooseSupport'));
    assert.deepEqual(slots.slice(0, 3).map(slot => slot.properties.get('--equipment-column')), ['1', '1', '0']);
    assert.deepEqual(slots.slice(0, 3).map(slot => slot.properties.get('--equipment-layer')), ['1', '2', '1']);
    assert.equal(slots[3].classes.has('attachedEquipment'), false, 'Non-equipment remains in support lane');
    assert.ok(slots[4].classes.has('emptySupport'));
    assert.equal(JSON.stringify({ cards, attachments }), before, 'Presentation must not modify game state');
    attachments[1] = 4;
    update();
    assert.equal(mainArea.properties.get('--equipment-depth'), '1');
    assert.equal(slots[1].properties.get('--equipment-column'), '5');
    elements.get(`${side}-ally-0`).card = null;
    update();
    assert.equal(slots[0].classes.has('attachedEquipment'), false, 'Missing carriers keep supports accessible');
    assert.equal(slots[0].properties.has('--equipment-layer'), false);
    attachments[1] = 99;
    update();
    assert.equal(slots[1].classes.has('attachedEquipment'), false);
    cards.fill('');
    update();
    assert.equal(mainArea.properties.get('--equipment-depth'), '0');
    assert.equal(zone.classes.has('hasLooseSupport'), false);
    slots.forEach((slot, index) => {
      assert.equal(zone.children[index], slot, 'Slot identity and logical order must remain unchanged');
      assert.equal(slot.dataset.slot, String(index));
      assert.ok(slot.classes.has('emptySupport'));
      assert.equal(slot.dataset.equipmentName, undefined);
      slot.onclick();
    });
    assert.equal(clicks, 5, 'Existing click handlers must survive layout changes');
  }
}
const html = await readFile(new URL('../game.html', import.meta.url), 'utf8');
const environmentDocks = [...html.matchAll(/<section class="environmentDock[^"]*"[\s\S]*?<\/section>/g)].map(match => match[0]);
assert.equal(environmentDocks.length, 2, 'Each playmat needs a dedicated environment area');
for (const side of ['you', 'ai']) {
  const id = `id="${side}-env"`;
  assert.equal(html.split(id).length - 1, 1, 'Preserve exactly one existing environment slot per side');
  const dock = environmentDocks.find(section => section.includes(id));
  assert.ok(dock?.includes('aria-label='), 'Each environment slot must retain an accessible label');
  const arenaStart = html.indexOf(`id="${side === 'you' ? 'youArena' : 'opArena'}"`);
  assert.ok(arenaStart >= 0 && html.indexOf(dock) > arenaStart, 'Environment area must be inside its playmat');
}
console.log('Field layout: JS/TS, both sides, equipment stacks, unchanged slot actions and dedicated environment slots passed.');
