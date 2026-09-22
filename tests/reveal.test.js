import test from 'node:test';
import assert from 'node:assert/strict';
import { revealStage, revealCountdown, revealViewGame, revealDurations, REVEAL_SUSPENSE_MS, REVEAL_ACTION_MS, REVEAL_IMPACT_MS } from '../src/reveal.js';
import { HAIR_ITEM_KIND } from '../src/game.js';

function game(overrides = {}) {
  return {
    phase: 'reveal',
    phaseStartedAt: 1000,
    rules: { version: 6, maxHair: 4, revealMs: 4000 },
    players: {
      a: { name:'Ana', hair:1, breath:0 },
      b: { name:'Beto', hair:3, breath:1 },
    },
    centerItem: null,
    lastResult: {
      turn: 3,
      actions: {
        a: { action:'blow', target:'b' },
        b: { action:'grab', target:'__center_item__' },
      },
      hits: [{ from:'a', to:'b', blocked:false }],
      losses: { a:1, b:0 },
      heals: { a:0, b:1 },
      item: { kind:HAIR_ITEM_KIND, outcome:'claimed', attempts:['b'], winnerId:'b', healed:1, spawnedTurn:3 },
    },
    ...overrides,
  };
}

test('0.27 da tiempo real para leer 3-2-1, jugadas y consecuencias', () => {
  const g = game();
  assert.deepEqual(revealDurations(g), {
    suspense:REVEAL_SUSPENSE_MS,
    actions:REVEAL_ACTION_MS,
    impact:REVEAL_IMPACT_MS,
  });
  assert.equal(revealStage(g, 1000), 'suspense');
  assert.equal(revealCountdown(g, 1000), 3);
  assert.equal(revealCountdown(g, 1000 + REVEAL_SUSPENSE_MS / 3 + 1), 2);
  assert.equal(revealCountdown(g, 1000 + REVEAL_SUSPENSE_MS * 2 / 3 + 1), 1);
  assert.equal(revealStage(g, 1000 + REVEAL_SUSPENSE_MS), 'actions');
  assert.equal(revealStage(g, 1000 + REVEAL_SUSPENSE_MS + REVEAL_ACTION_MS), 'impact');
});

test('partidas v5 ya iniciadas ajustan la coreografía a sus 3.2 s sin quedar sin impacto', () => {
  const g = game({ rules:{ version:5, maxHair:4, revealMs:3200 } });
  const durations = revealDurations(g);
  assert.equal(durations.suspense + durations.actions + durations.impact, 3200);
  assert.equal(revealStage(g, 1000 + 3199), 'impact');
});

test('partidas anteriores a la secuencia conservan la revelación inmediata', () => {
  const g = game({ rules:{ version:4, maxHair:4, revealMs:2500 } });
  assert.equal(revealStage(g, 1000), 'impact');
  assert.equal(revealCountdown(g, 1000), null);
});

test('antes del impacto se reconstruye el Pelo previo y el mechón sigue visible', () => {
  const g = game();
  const view = revealViewGame(g, 'actions');
  assert.equal(view.players.a.hair, 2);
  assert.equal(view.players.b.hair, 2);
  assert.equal(view.centerItem.kind, HAIR_ITEM_KIND);
  assert.equal(view.centerItem.spawnedTurn, 3);
  assert.equal(revealViewGame(g, 'impact'), g);
});

test('la ronda final también usa la secuencia antes de mostrar el desenlace', () => {
  const g = game({ phase:'finished' });
  assert.equal(revealStage(g, 1000), 'suspense');
  assert.equal(revealStage(g, 1000 + REVEAL_SUSPENSE_MS + REVEAL_ACTION_MS), 'impact');
});
