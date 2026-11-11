import assert from 'node:assert/strict';
import { createRenderingHarness, Element } from './helpers/rendering-harness.mjs';

let scenarios = 0;
function assertSameNodes(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((element, index) => assert.equal(element, expected[index], message));
}
const definitions = {
  a: { kind: 'ally', cost: 1, img: 'a.png', name: 'A' },
  b: { kind: 'ally', cost: 2, img: 'b.png', name: 'B' },
  c: { kind: 'ally', cost: 3, img: 'c.png', name: 'C' },
  env: { kind: 'env', img: 'env.png' }
};

for (const extension of ['js', 'ts']) {
  const options = { sleeves: { you: 'back.png', ai: 'back.png' } };
  const ui = await createRenderingHarness(extension, options, definitions);
  const art = element => element.querySelector('.slotCardImg');
  const cards = ui.render(['a', 'a', 'b']).slice();
  const images = cards.map(art);
  const moves = cards.map(card => card.moves);
  const writes = images.map(image => image.sourceAssignments);
  const draws = () => ui.calls.animations.filter(call => call.name === 'anim-draw').length;
  assert.equal(draws(), 3);
  for (let patch = 0; patch < 20; patch++) {
    assertSameNodes(ui.render(['a', 'a', 'b']), cards, 'Unchanged patches retain every duplicate root');
    assertSameNodes(cards.map(art), images, 'Retain the decoded images');
  }
  assert.deepEqual(cards.map(card => card.moves), moves, 'Do not detach/reinsert unchanged cards');
  assert.deepEqual(images.map(image => image.sourceAssignments), writes, 'Do not reset image sources');
  assert.equal(draws(), 3, 'Unchanged patches do not replay draw animations');
  ui.setFragments(0);
  assert.ok(ui.render(['a', 'a', 'b']).every(card => !card.classList.contains('is-playable')));
  const afterDraw = ui.render(['a', 'a', 'b', 'c']).slice();
  assertSameNodes(afterDraw.slice(0, 3), cards);
  assert.equal(draws(), 4, 'Animate only the newly drawn copy');
  assertSameNodes(ui.render(['b', 'a', 'c']), [cards[2], cards[0], afterDraw[3]], 'Remove/reorder without replacing survivors');
  cards[0].onclick();
  assert.deepEqual(ui.elements.get('youHand').children.map(card => card.dataset.cardId), ['b', 'a', 'c'],
    'Reused click handlers use the current hand, not an old captured array');
  assert.ok(cards[0].classList.contains('is-selected'));
  const extraCopy = ui.render(['b', 'a', 'a', 'c']);
  assertSameNodes([extraCopy[0], extraCopy[1], extraCopy[3]], [cards[2], cards[0], afterDraw[3]]);
  assert.notEqual(extraCopy[2], cards[0], 'A newly drawn duplicate needs its own node');
  assert.equal(draws(), 5, 'Animate just the new duplicate');
  ui.render([]);
  ui.render([]);
  assert.equal(ui.elements.get('youHand').children.length, 1, 'Keep a single empty-hand placeholder');
  scenarios += 14;

  const hidden = ui.render(['unknown-0', 'unknown-1'], false).slice();
  assertSameNodes(ui.render(['unknown-0', 'unknown-1'], false), hidden);
  options.sleeves.ai = 'new-back.png';
  ui.render(['unknown-0', 'unknown-1'], false);
  assert.ok(art(hidden[0]).src.includes('new-back.thumb.webp'), 'Update changed sleeves without replacing cards');
  assert.equal(ui.elements.get('enemyHandCount').textContent, '2 cartas');
  scenarios += 3;

  const image = new Element('img');
  ui.setThumbnailSource(image, 'missing.png');
  image.onerror();
  const fallbackWrites = image.sourceAssignments;
  ui.setThumbnailSource(image, 'missing.png');
  assert.equal(image.sourceAssignments, fallbackWrites, 'Do not retry failed thumbnails on every patch');
  assert.ok(image.src.includes('missing.png'));
  ui.setThumbnailSource(image, 'new.png');
  assert.ok(image.src.includes('new.thumb.webp'), 'A changed source still loads');
  scenarios += 3;

  const field = ui.add('you-field');
  const slot = field.appendChild(new Element());
  ui.renderLane('you-field', ['a'], null, undefined, [5]);
  const ally = slot.querySelector('.card');
  const allyArt = art(ally);
  ui.tappedBySide.you.add(0);
  options.attack = 4;
  options.blood = 2;
  options.equips = 1;
  ui.renderLane('you-field', ['a'], 0, index => ui.calls.clicks.push(index), [2]);
  assert.equal(slot.querySelector('.card'), ally);
  assert.equal(art(ally), allyArt);
  assert.equal(allyArt.sourceAssignments, 1);
  assert.ok(ally.classList.contains('tapped'));
  assert.deepEqual(ally.querySelector('.allyStatsRow').value, { hp: 2, maxHp: 5, attack: 4, resistance: 0 });
  assert.equal(ally.querySelectorAll('.allyStatsRow').length, 1, 'Do not accumulate badges');
  assert.equal(ally.querySelectorAll('.markerTag').length, 1);
  assert.equal(ally.querySelectorAll('.equipAttachTag').length, 1);
  slot.onclick();
  assert.equal(ui.calls.clicks.at(-1), 0);
  ui.tappedBySide.you.clear();
  options.blood = 0;
  options.equips = 0;
  ui.renderLane('you-field', ['a'], null, undefined, [4]);
  assert.ok(!ally.classList.contains('tapped'));
  assert.equal(ally.querySelectorAll('.markerTag, .equipAttachTag').length, 0, 'Remove obsolete badges');
  assert.equal(ui.calls.animations.filter(call => call.name === 'anim-play').length, 1);
  ui.renderLane('you-field', ['b'], null);
  assert.notEqual(slot.querySelector('.card'), ally, 'Real replacements change the card');
  assert.equal(ui.calls.ghosts.length, 1, 'Keep departure animations');
  ui.renderLane('you-field', [], null);
  assert.equal(slot.querySelector('.card'), null);
  scenarios += 15;

  const support = ui.add('you-support');
  const supportSlot = support.appendChild(new Element());
  ui.renderLane('you-support', ['a'], null);
  const supportCard = supportSlot.querySelector('.card');
  options.counter = 3;
  ui.renderLane('you-support', ['a'], null);
  assert.equal(supportSlot.querySelector('.card'), supportCard);
  assert.equal(supportCard.querySelector('.equipAttachTag').value, 3);
  options.counter = 0;
  ui.renderLane('you-support', ['a'], null);
  assert.equal(supportCard.querySelector('.equipAttachTag'), null);
  scenarios += 3;

  const leaderSlot = ui.add('you-leader');
  ui.renderLeaderSlot('you-leader', 'a', 20);
  const leader = leaderSlot.querySelector('.card');
  options.leaderReady = true;
  ui.setLeaderTapped(true);
  ui.renderLeaderSlot('you-leader', 'a', 12);
  assert.equal(leaderSlot.querySelector('.card'), leader);
  assert.equal(art(leader).sourceAssignments, 1);
  assert.ok(leader.classList.contains('chosenReady') && leader.classList.contains('tapped'));
  assert.equal(leader.querySelector('.allyStatsRow').value.hp, 12);
  ui.renderLeaderSlot('you-leader', '', 0);
  assert.equal(leaderSlot.querySelector('.card'), null);
  scenarios += 5;

  const envSlot = ui.add('you-env');
  ui.renderEnvSlot('you-env', 'env', true);
  const environment = envSlot.querySelector('.card');
  ui.renderEnvSlot('you-env', 'env', true);
  assert.equal(envSlot.querySelector('.card'), environment);
  assert.equal(art(environment).sourceAssignments, 1);
  ui.renderEnvSlot('you-env', null, false);
  assert.equal(envSlot.querySelector('.card'), null);
  scenarios += 3;

  const deckSlot = ui.add('you-deck');
  const deckCount = ui.add('youDeckCount');
  ui.renderDeckSlot('you-deck', 'youDeckCount', 30);
  const deck = deckSlot.querySelector('.deckVisualCard');
  ui.renderDeckSlot('you-deck', 'youDeckCount', 29);
  assert.equal(deckSlot.querySelector('.deckVisualCard'), deck);
  assert.equal(art(deck).sourceAssignments, 1);
  assert.equal(deckCount.textContent, '29');
  ui.renderDeckSlot('you-deck', 'youDeckCount', 0);
  assert.equal(deckSlot.querySelector('.deckVisualCard'), null);
  scenarios += 4;

  const pile = ui.add('you-grave');
  const pileCount = ui.add('youGraveCount');
  ui.renderVisiblePileSlot('you-grave', 'youGraveCount', ['a', 'b', 'c'], false);
  const layers = pile.children.slice();
  ui.renderVisiblePileSlot('you-grave', 'youGraveCount', ['a', 'a', 'b', 'c'], false);
  assertSameNodes(pile.children, layers, 'Keep unchanged visible pile layers');
  assert.equal(pileCount.textContent, '4');
  ui.renderVisiblePileSlot('you-grave', 'youGraveCount', ['a', 'b'], false);
  assert.equal(pile.children.length, 2);
  assert.equal(pile.children.at(-1).dataset.cardId, 'b');
  scenarios += 4;

  const fragments = ui.add('you-fragsDock');
  ui.renderFragments('you-fragsDock', 4, 5, 'frag.png');
  const tokens = fragments.children.slice();
  ui.renderFragments('you-fragsDock', 2, 5, 'frag.png', true);
  assertSameNodes(fragments.children, tokens);
  assert.ok(tokens[0].classList.contains('spent') && !tokens[0].classList.contains('on'));
  assert.ok(tokens[1].classList.contains('on') && !tokens[3].classList.contains('on'));
  ui.renderFragments('you-fragsDock', 3, 3, 'other.png');
  assertSameNodes(fragments.children, tokens.slice(0, 3));
  assert.ok(!tokens[0].classList.contains('spent') && tokens[0].classList.contains('on'));
  assert.equal(tokens[0].title, '');
  assert.equal(tokens[0].style['--frag-img'], "url('other.png')");
  scenarios += 7;

  const modal = ui.add('pileModal');
  const box = modal.appendChild(new Element());
  box.className = 'modalBox';
  const header = box.appendChild(new Element());
  header.appendChild(ui.add('pileTitle'));
  const grid = box.appendChild(ui.add('pileGrid'));
  options.pile = ['a', 'b'];
  ui.renderPileModal();
  const modalCards = grid.children.slice();
  ui.renderPileModal();
  assertSameNodes(grid.children, modalCards);
  options.pile = ['a', 'b', 'c'];
  ui.renderPileModal();
  assert.equal(grid.children.length, 3);
  ui.setPile('you', 'deck');
  ui.renderPileModal();
  assert.equal(art(grid.children[0]).alt, 'Carta virada');
  scenarios += 3;
}
console.log(`Stable rendering: ${scenarios} JS/TS scenarios passed (node/image identity, duplicate hands, source fallback, live state and real animations).`);
