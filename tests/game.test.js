import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, newGame, resolveRound, validateIntent, pruneLobby } from '../src/game.js';

const members = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { name: `Jugador ${i}`, joinedAt: i, lastSeenAt: 1000, left: false }]));
const game = (count = 2) => newGame('room', members(count), 1000);
const choice = (action, target = null, turn = 1) => ({ action, target, turn });

test('partida de 2 y 6 jugadores; límites y recursos iniciales', () => {
  for (const count of [2, 6]) {
    const state = game(count);
    assert.equal(state.memberIds.length, count);
    assert.equal(state.deadline, 9000);
    for (const p of Object.values(state.players)) assert.deepEqual([p.hair, p.breath], [3, 0]);
  }
  assert.throws(() => game(1)); assert.throws(() => game(7));
});
test('aire respeta el máximo, distraído no cambia recursos', () => {
  const state = game(); state.players['0'].breath = 2;
  const result = resolveRound(state, { 0: choice('air') });
  assert.equal(result.players['0'].breath, 2);
  assert.deepEqual(result.players['1'], state.players['1']);
  assert.equal(result.result.actions['1'].action, 'distracted');
});
test('esconderse bloquea todos los ataques, pero los atacantes gastan soplo', () => {
  const state = game(3);
  state.players['0'].breath = state.players['1'].breath = 1;
  const result = resolveRound(state, { 0: choice('blow', '2'), 1: choice('blow', '2'), 2: choice('hide') });
  assert.equal(result.players['2'].hair, 3);
  assert.equal(result.players['0'].breath, 0);
  assert.equal(result.players['1'].breath, 0);
  assert.ok(result.result.hits.every(hit => hit.blocked));
});
test('dos ataques mutuos se ejecutan incluso si ambos quedan eliminados', () => {
  const state = game();
  for (const p of Object.values(state.players)) { p.hair = 1; p.breath = 1; }
  const result = resolveRound(state, { 0: choice('blow', '1'), 1: choice('blow', '0') });
  assert.equal(result.players['0'].hair, 0); assert.equal(result.players['1'].hair, 0);
  assert.equal(result.draw, true); assert.equal(result.finished, true); assert.equal(result.winnerId, null);
});
test('varios soplos al mismo objetivo suman daño sin Pelo negativo', () => {
  const state = game(6); state.players['5'].hair = 2;
  const intents = {};
  for (let i = 0; i < 5; i++) { state.players[i].breath = 1; intents[i] = choice('blow', '5'); }
  const result = resolveRound(state, intents);
  assert.equal(result.players['5'].hair, 0);
  assert.equal(result.result.losses['5'], 2);
  assert.equal(result.result.hits.length, 5);
});
test('eliminados no actúan; ganador con exactamente 2 jugadores', () => {
  const state = game(); state.players['0'].breath = 1; state.players['1'].hair = 1;
  const result = resolveRound(state, { 0: choice('blow', '1') });
  assert.equal(result.winnerId, '0'); assert.equal(result.finished, true);
  state.players['1'].hair = 0;
  assert.equal(resolveRound(state, { 1: choice('air') }).result.actions['1'], undefined);
});
test('rechaza turnos viejos, fuera de tiempo, recursos insuficientes y objetivos inválidos', () => {
  const state = game();
  assert.throws(() => validateIntent(state, '0', choice('air', null, 0), 1001));
  assert.throws(() => validateIntent(state, '0', choice('air'), 9000));
  assert.throws(() => validateIntent(state, '0', choice('blow', '1'), 1001));
  state.players['0'].breath = 1;
  for (const target of ['0', 'missing', null]) assert.throws(() => validateIntent(state, '0', choice('blow', target), 1001));
  state.players['1'].hair = 0;
  assert.throws(() => validateIntent(state, '0', choice('blow', '1'), 1001));
  assert.throws(() => validateIntent(state, '0', choice('air', '1'), 1001));
});
test('la resolución no modifica su entrada y no depende del orden de los ataques', () => {
  const state = game(); state.players['0'].breath = state.players['1'].breath = 1;
  const old = structuredClone(state);
  const a = { 0: choice('blow', '1'), 1: choice('blow', '0') };
  assert.deepEqual(resolveRound(state, a).players, resolveRound(state, Object.fromEntries(Object.entries(a).reverse())).players);
  assert.deepEqual(state, old);
});
test('lease expirada transfiere host y cierra lobby vacío', () => {
  const room = { status: 'lobby', hostId: '0', members: members(2) };
  room.members['1'].lastSeenAt = 50000;
  assert.equal(pruneLobby(room, 50000).hostId, '1');
  assert.deepEqual(Object.keys(pruneLobby(room, 50000).members), ['1']);
  assert.equal(pruneLobby(room, 100000).status, 'closed');
});
test('reglas quedan copiadas en cada partida', () => {
  const rules = { ...RULES }; const state = newGame('room', members(2), 1000, rules);
  rules.turnMs = 100; assert.equal(state.rules.turnMs, 8000);
});
