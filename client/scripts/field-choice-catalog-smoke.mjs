import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { MatchState } = require('../../server/dist/rooms/schema/MatchState.js');
const { playCard, activateLeaderPower, endTurn } = require('../../server/dist/rooms/match/matchEngine.js');
const { getCardDefs } = require('../../server/dist/game/cardCatalog.js');
const helper = await readFile(new URL('../src/ui/fieldChoices.js', import.meta.url), 'utf8');
const { canChooseOnField } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const cards = getCardDefs();
const equipment = cards.filter(card => card.kind === 'equip');
const animal = cards.find(card => card.kind === 'ally' && card.tipo === 'Animal');
const martial = cards.find(card => card.kind === 'ally' && card.filiacao === 'Marcial' && card.classe === 'Guerreiro');
const citizen = cards.find(card => card.kind === 'ally' && card.classe === 'Cidadão');
assert.ok(animal && martial && citizen);
const records = new Map();
let scenarios = 0;

function fixture(slot) {
  const state = new MatchState();
  state.game.turn = 5;
  state.game.turnSlot = slot;
  state.game.phase = 'PREP';
  for (const side of ['p1', 'p2']) {
    const player = state.game[side];
    player.leaderId = 'Leafae, Guardião da Floresta';
    player.hp = 20;
    player.fragments = player.fragmentMax = 20;
    player.leaderVitalMarks = 5;
    player.leaderSpiderMarks = 5;
    player.env = 'Catedral Ensolarada';
    player.field.push(animal.name, martial.name, citizen.name, 'Jabuti Barreira', '');
    player.fieldHp.push(2, 2, 2, 2, 0);
    player.fieldTapped.push(false, false, false, false, false);
    player.support.push(...equipment.slice(0, 4).map(card => card.name), '');
    player.supportAttachTo.push(0, 0, 0, 0, -2);
    player.supportCounters.push(0, 0, 0, 0, 0);
    player.hand.push(equipment[0].name, equipment[1].name);
    player.grave.push('Mãos Flamejantes', martial.name, animal.name);
    player.deck.push(...cards.filter(card => card.kind !== 'leader').map(card => card.name));
  }
  return state;
}

function choices(state, name, branch, requests, preferredId) {
  let depth = 0;
  const elements = new Map();
  return (slot, payload, resolve) => {
    assert.ok(++depth < 30, `${name}: unexpected choice loop`);
    const resolveTarget = option => {
      const owner = state.game[option.side];
      if (!owner) return null;
      const cardId = option.lane === 'field' ? owner.field[option.pos]
        : option.lane === 'support' ? owner.support[option.pos]
          : option.lane === 'env' ? (option.cardId === owner.leaderId ? owner.leaderId : owner.env) : '';
      if (!cardId || cardId !== option.cardId) return null;
      const key = `${option.side}/${option.lane}/${option.pos ?? option.cardId}`;
      if (!elements.has(key)) elements.set(key, {});
      return elements.get(key);
    };
    const direct = canChooseOnField(payload.options, resolveTarget);
    if (payload.options.some(option => ['hand', 'deck', 'grave'].includes(option.lane))) {
      assert.equal(direct, false, `${name}: off-board choices must keep the centered modal`);
    }
    if (payload.options.every(option => !option.lane)) {
      assert.equal(direct, false, `${name}: effect/activation decisions must keep the centered modal`);
    }
    const record = { payload, direct, slot };
    requests.push(record);
    const entries = records.get(name) || [];
    entries.push(record);
    records.set(name, entries);
    const enabled = payload.options.filter(option => !option.disabled);
    const selected = enabled.find(option => option.id === preferredId)
      || enabled.find(option => option.id === `choice-${branch}`) || enabled[0];
    resolve(selected?.id ?? null);
  };
}

for (const slot of ['p1', 'p2']) {
  for (const branch of ['a', 'b']) {
    for (const card of cards) {
      const state = fixture(slot);
      const player = state.game[slot];
      const requests = [];
      const ask = choices(state, card.name, branch, requests);
      const events = [];
      const broadcast = (type, payload) => events.push({ type, ...payload });
      if (card.kind === 'leader') {
        player.leaderId = card.name;
        activateLeaderPower(state, slot, broadcast, ask);
      } else {
        player.hand.unshift(card.name);
        playCard(state, slot, card.name, 4, card.kind, broadcast,
          { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() }, ask);
        if (card.kind !== 'truque') assert.equal(events.some(event => event.type === 'error'), false, card.name);
      }
      if (equipment.includes(card)) {
        assert.ok(requests.some(request => request.direct
          && request.payload.options.some(option => option.id === 'equip-leader')), card.name);
      }
      if (card.name === 'Mãos Flamejantes') {
        assert.equal(requests[0].payload.options.length, 10);
        assert.equal(requests[0].direct, true);
      }
      scenarios++;
    }
  }
  const state = fixture(slot);
  const requests = [];
  endTurn(state, () => {}, { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() },
    { p1: new Set(), p2: new Set() },
    choices(state, 'Catedral Ensolarada', 'a', requests));
  assert.ok(requests.some(request => request.direct && request.payload.title.includes('Catedral')));
  scenarios++;

  const agiota = fixture(slot);
  agiota.game[slot].field[0] = 'Aranhas Negras, Agiota';
  agiota.game[slot].fieldHp[0] = 5;
  agiota.game[slot].hand.unshift('Fruto Abençoado');
  const payments = [];
  playCard(agiota, slot, 'Fruto Abençoado', undefined, 'spell', () => {},
    { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() },
    choices(agiota, 'Aranhas Negras, Agiota', 'a', payments));
  assert.ok(payments.some(request => request.direct && request.payload.options.some(option => option.id === 'agiota-no')));
  assert.ok(payments.some(request => request.payload.choiceKind === 'activation'));
  scenarios++;

  const executor = fixture(slot);
  const other = slot === 'p1' ? 'p2' : 'p1';
  for (const side of ['p1', 'p2']) {
    executor.game[side].field[4] = citizen.name;
    executor.game[side].fieldHp[4] = 2;
    executor.game[side].support[4] = equipment[4].name;
    for (let pos = 0; pos < 5; pos++) executor.game[side].supportAttachTo[pos] = -1;
  }
  executor.game[slot].hand.unshift('Aranhas Negras, Executor');
  const displacements = [];
  playCard(executor, slot, 'Aranhas Negras, Executor', undefined, 'ally', () => {},
    { p1: new Set(), p2: new Set() }, { p1: new Set(), p2: new Set() },
    choices(executor, 'Aranhas Negras, Executor', 'a', displacements, `support-${other}-4`));
  const displacement = displacements.find(request => request.payload.title.includes('para deslocar'));
  assert.ok(displacements.some(request => request.payload.choiceKind === 'replacement'),
    'Full-field replacement has its own presentation, not an ordinary target selection');
  assert.ok(displacement?.direct);
  assert.equal(displacement.payload.options.length, 22, 'Executor includes 10 allies, 10 supports and 2 environments');
  assert.deepEqual(new Set(displacement.payload.options.map(option => option.lane)), new Set(['field', 'support', 'env']));
  assert.ok(displacement.payload.options.every(option => option.cardId !== executor.game[option.side].leaderId),
    'Executor never targets a Chosen, even when choosing equipment on that Chosen');
  assert.equal(executor.game[other].support[4], '');
  assert.ok(executor.game[other].banished.includes(equipment[4].name));
  assert.equal(executor.game[other].hp, 20, 'Choosing attached equipment does not choose its carrier');
  scenarios++;
}

const directCards = [
  'Mãos Flamejantes', 'Cervo de Galhos Brancos', 'Aranhas Negras, Executor', 'Goblin Sabotador',
  'Profanação de Terreno', 'Controle de Correntezas', 'Quebra-Aço', 'Sede de Vingança',
  'Aranhas Negras, Milícia', 'Pica-pau Agulheiro', 'Troca de Energia', 'Tônico Revigorante',
  'Fruto Abençoado', 'Invasão de Cativeiro', 'Bem Treinado', 'Leafae, Guardião da Floresta',
  'Catedral Ensolarada', 'Aranhas Negras, Agiota', ...equipment.map(card => card.name)
];
for (const name of new Set(directCards)) {
  assert.ok(records.get(name)?.some(request => request.direct), `${name}: no direct target exercised`);
}
for (const name of ['Charlatão da Vila', 'Estudante Arcano', 'Espionagem Sorrateira', 'Gamboa, a Caçadora']) {
  const handChoices = records.get(name)?.filter(request => request.payload.options.some(option => option.lane === 'hand'));
  assert.ok(handChoices?.length, `${name}: hand metadata not exercised`);
  assert.ok(handChoices.every(request => !request.direct), `${name}: hand/support copy collision`);
}
assert.ok(records.get('Redoma Santa').some(request => request.direct && request.payload.title.includes('curar')));
console.log(`Catalog choices: ${cards.length} cards audited in ${scenarios} server scenarios; ${new Set(directCards).size} named direct-choice paths, both sides and A/B effects passed.`);
