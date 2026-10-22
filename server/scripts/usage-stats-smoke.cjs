const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UsageStatsStore, createUsageRecorder } = require('../dist/utils/usageStats');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mytragor-usage-'));
  let date = new Date('2026-10-21T12:00:00Z');
  const file = path.join(root, 'stats.json');
  const store = new UsageStatsStore(file, true, () => date);
  try {
    await store.initialize();
    const game = {
      p1: { leaderId: 'ranza', hand: ['Cão de Caça Feroz'], deck: ['Cão de Caça Feroz', 'token_povo', '<player-name>'] },
      p2: { leaderId: 'katsu', hand: [], deck: ['Cervo de Galhos Brancos'] }
    };
    const record = createUsageRecorder('solo', store);
    record('mulligan_start', {}, game);
    record('mulligan_start', {}, game);
    record('turn_start', {}, game);
    const played = { slot: 'p1', fromHand: true, cardId: 'Cão de Caça Feroz', cost: 0, seq: 10 };
    record('card_played', played, game);
    record('card_played', played, game);
    record('card_played', { ...played, fromHand: false, seq: 11 }, game);
    record('card_played', { ...played, cardId: 'token_povo', seq: 12 }, game);
    record('card_played', { ...played, slot: 'p2', cardId: 'Cervo de Galhos Brancos', seq: 13 }, game);
    const solo = store.snapshot('solo', 7);
    assert.equal(solo.decks, 1);
    assert.equal(solo.cards.length, 1);
    assert.equal(solo.cards[0].decks, 1);
    assert.equal(solo.cards[0].copies, 2);
    assert.equal(solo.cards[0].plays, 1);
    assert.equal(store.snapshot('ai', 7).cards[0].plays, 1);
    assert.equal(store.snapshot('all', 7).decks, 2);
    createUsageRecorder('pvp', store)('mulligan_start', {}, game);
    assert.equal(store.snapshot('pvp', 7).decks, 2);
    assert.equal(store.snapshot('all', 7).decks, 4);
    await store.flush();
    const saved = await fs.readFile(file, 'utf8');
    assert.ok(!saved.includes('player-name'));
    const restored = new UsageStatsStore(file, true, () => date);
    await restored.initialize();
    assert.deepEqual(restored.snapshot(), store.snapshot());
    date = new Date('2026-10-29T12:00:00Z');
    assert.equal(store.snapshot('all', 7).decks, 0);
    assert.equal(store.snapshot('all', 30).decks, 4);
    date = new Date('2027-02-01T12:00:00Z');
    assert.equal(store.snapshot('all', 90).decks, 0);
    const corruptFile = path.join(root, 'corrupt.json');
    const corrupt = JSON.stringify({ version: 1, days: { '2026-10-21': { solo: { decks: 'bad' } } } });
    await fs.writeFile(corruptFile, corrupt);
    const degraded = new UsageStatsStore(corruptFile, true, () => date);
    await degraded.initialize();
    degraded.recordDeck('solo', 'ranza', ['Cão de Caça Feroz']);
    assert.equal(degraded.snapshot().storage.healthy, false);
    assert.equal(degraded.snapshot().decks, 1);
    await degraded.flush();
    assert.equal(await fs.readFile(corruptFile, 'utf8'), corrupt);
    const faulty = createUsageRecorder('solo', { recordDeck() { throw new Error('simulated storage failure'); } });
    assert.doesNotThrow(() => faulty('mulligan_start', {}, game));
    assert.doesNotThrow(() => faulty('mulligan_start', {}, game));
    console.log('Usage statistics: deduplication, mode separation, free plays, token exclusion, copies, privacy, disk reload and retention passed.');
  } finally {
    await store.flush();
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });