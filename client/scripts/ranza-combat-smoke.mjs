import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Import the browser-loaded JavaScript as ESM regardless of package module type.
const source = await readFile(new URL('../src/game/battle.js', import.meta.url), 'utf8');
const battle = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
globalThis.document = { querySelectorAll: () => [], getElementById: () => null };

function check({ cost, leader = 'ranza', tapped = false, taunt = false, summoned = false, expected }) {
  const attacker = { name: 'Atacante', hp: 4, cost, classe: 'Guerreiro', summonedThisTurn: summoned };
  const target = { name: 'Alvo', hp: 3, tapped, keywords: [] };
  const sent = [];
  const runtime = {
    state: {
      phase: 'combat', turnCount: { you: 2, ai: 2 },
      you: { leader: { name: leader, hp: 30 }, allies: [attacker], grave: [] },
      ai: { leader: { name: 'Oponente', hp: 30 }, allies: [target], grave: [] }
    },
    leaderIs: (side, key) => side === 'you' && key === leader,
    hasKw: (card, keyword) => (card.keywords || []).includes(keyword),
    rnd: () => 0, getAC: () => 0, serverAuthoritative: true,
    onAttackResolved: (selection, chosen) => sent.push({ selection, chosen })
  };
  if (taunt) runtime.state.ai.allies.push({ name: 'Provocador', hp: 3, tapped: true, keywords: ['provocar'] });
  const chosen = { type: 'ally', side: 'ai', index: 0 };
  assert.equal(battle.canAttackTargetQuiet(runtime, { side: 'you', idx: 0 }, chosen), expected);
  battle.selectAttacker(runtime, 'you', 0);
  battle.resolveAttackOn(runtime, chosen);
  assert.equal(sent.length, expected ? 1 : 0, 'Selection and dispatch must agree');
  if (expected) assert.deepEqual(sent[0].chosen, chosen);
  battle.endAttackCleanup(runtime);
}

check({ cost: 3, expected: true });
check({ cost: 4, expected: true });
check({ cost: 5, expected: false });
check({ cost: 4, expected: true }); // A rejected attack must not break the next one.
check({ cost: 5, tapped: true, expected: true });
check({ cost: 4, taunt: true, expected: false });
check({ cost: 4, summoned: true, expected: false });
check({ cost: 4, leader: 'ademais', expected: false });
check({ cost: 5, leader: 'katsu', expected: true });
console.log('Ranza combat: 9 selection/dispatch regression checks passed.');