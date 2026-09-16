import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from '../functions/node_modules/firebase-admin/lib/esm/app/index.js';
import { getFirestore } from '../functions/node_modules/firebase-admin/lib/esm/firestore/index.js';
import { createService } from '../functions/src/service.js';

let app, db, service, time = 100000;
before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Integration tests require the emulator.');
  app = initializeApp({ projectId: 'demo-pelaobolao' }, 'integration');
  db = getFirestore(app); service = createService(db, () => time);
});
after(async () => { await db.terminate(); await deleteApp(app); });
let sequence = 0;
async function pair() {
  const a = `a${++sequence}`, b = `b${sequence}`;
  await service.saveProfile(a, { name: 'A' }); await service.saveProfile(b, { name: 'B' });
  const { roomId } = await service.roomCommand(a, { command: 'create' });
  const room = (await db.doc(`rooms/${roomId}`).get()).data();
  await service.roomCommand(b, { command: 'join', code: room.code });
  return { a, b, roomId, code: room.code };
}
async function started() {
  const pairInfo = await pair();
  await service.roomCommand(pairInfo.a, { command: 'start', roomId: pairInfo.roomId });
  return { ...pairInfo, gameId: (await db.doc(`rooms/${pairInfo.roomId}`).get()).data().gameId };
}
const intent = (gameId, turn, action, target = null, requestId = `req${++sequence}`, expectedRevision = 0) => ({ gameId, turn, action, target, requestId, expectedRevision });

test('creación y comienzo duplicados son idempotentes; solo host inicia', async () => {
  const { a, b, roomId } = await pair();
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => service.roomCommand(a, { command: 'create' })));
  assert.ok(duplicates.every(r => r.roomId === roomId));
  await assert.rejects(service.roomCommand(b, { command: 'start', roomId }));
  await Promise.all([service.roomCommand(a, { command: 'start', roomId }), service.roomCommand(a, { command: 'start', roomId })]);
  const games = await db.collection('games').where('roomId', '==', roomId).get();
  assert.equal(games.size, 1);
});
test('intención provisional, replay, revisión y acción tardía', async () => {
  const { a, gameId } = await started();
  const first = intent(gameId, 1, 'air');
  const receipts = await Promise.all([service.submitIntent(a, first), service.submitIntent(a, first)]);
  assert.equal(receipts[0].revision, 1); assert.equal(receipts[1].revision, 1);
  await service.submitIntent(a, intent(gameId, 1, 'hide', null, 'second', 1));
  assert.equal((await db.doc(`games/${gameId}`).get()).data().players[a].breath, 0);
  await assert.rejects(service.submitIntent(a, intent(gameId, 1, 'air', null, 'old', 0)));
  time += 8000;
  await assert.rejects(service.submitIntent(a, intent(gameId, 1, 'air', null, 'late', 2)));
  await assert.rejects(service.submitIntent(a, first));
});
test('resolutores concurrentes crean un solo resultado y gastan una sola vez', async () => {
  const { a, b, gameId } = await started();
  await db.doc(`games/${gameId}`).update({ [`players.${a}.breath`]: 1, [`players.${b}.breath`]: 1 });
  await service.submitIntent(a, intent(gameId, 1, 'blow', b));
  await service.submitIntent(b, intent(gameId, 1, 'blow', a));
  time += 8000;
  const results = await Promise.all(Array.from({ length: 10 }, () => service.advance(gameId, { turn: 1, phase: 'choosing' })));
  assert.equal(results.filter(r => r.advanced).length, 1);
  const state = (await db.doc(`games/${gameId}`).get()).data();
  assert.equal(state.players[a].hair, 2); assert.equal(state.players[b].hair, 2);
  assert.equal(state.players[a].breath, 0); assert.equal(state.players[b].breath, 0);
  assert.equal((await db.collection(`games/${gameId}/rounds`).get()).size, 1);
  assert.equal((await db.collection('jobs').where('gameId', '==', gameId).get()).size, 2);
  time += 2500;
  await Promise.all([service.advance(gameId, { turn: 1, phase: 'reveal' }), service.advance(gameId, { turn: 1, phase: 'reveal' })]);
  assert.equal((await db.doc(`games/${gameId}`).get()).data().turn, 2);
  assert.equal((await service.advance(gameId, { turn: 1, phase: 'choosing' })).advanced, false);
});
test('partida completa de 2 jugadores, ganador y revancha sin modificar perfiles', async () => {
  const { a, b, gameId, roomId } = await started();
  const profileBefore = (await db.doc(`profiles/${a}`).get()).data();
  for (let turn = 1; turn <= 6; turn++) {
    await service.submitIntent(a, intent(gameId, turn, turn % 2 ? 'air' : 'blow', turn % 2 ? null : b));
    time += 8000; await service.advance(gameId);
    if (turn < 6) { time += 2500; await service.advance(gameId); }
  }
  const state = (await db.doc(`games/${gameId}`).get()).data();
  assert.equal(state.winnerId, a); assert.equal(state.players[b].hair, 0); assert.equal(state.phase, 'finished');
  assert.deepEqual((await db.doc(`profiles/${a}`).get()).data(), profileBefore);
  await service.roomCommand(b, { command: 'touch', roomId });
  // a returns and its own lease is refreshed before host election.
  await service.roomCommand(a, { command: 'touch', roomId });
  const hostId = (await db.doc(`rooms/${roomId}`).get()).data().hostId;
  await service.roomCommand(hostId, { command: 'lobby', roomId });
  await service.roomCommand(hostId, { command: 'start', roomId });
  assert.notEqual((await db.doc(`rooms/${roomId}`).get()).data().gameId, gameId);
});
test('abandono explícito y lease transfieren host, reingreso restaura sesión', async () => {
  const { a, b, roomId, code } = await pair();
  await service.roomCommand(a, { command: 'leave', roomId });
  assert.equal((await db.doc(`rooms/${roomId}`).get()).data().hostId, b);
  await service.roomCommand(a, { command: 'join', code });
  assert.equal((await db.doc(`sessions/${a}`).get()).data().roomId, roomId);
  time += 46000;
  await service.roomCommand(a, { command: 'touch', roomId });
  assert.equal((await db.doc(`rooms/${roomId}`).get()).data().hostId, a);
});
test('partida queda abandonada si todos desaparecen por 2 minutos', async () => {
  const { gameId } = await started(); time += 120001;
  await service.advance(gameId);
  assert.equal((await db.doc(`games/${gameId}`).get()).data().phase, 'abandoned');
});
test('no se aceptan campos extra, nombres inválidos ni acceso ajeno', async () => {
  await assert.rejects(service.saveProfile('evil', { name: 'x', hair: 999 }));
  await assert.rejects(service.saveProfile('evil', { name: ' ' }));
  const { gameId } = await started();
  await assert.rejects(service.submitIntent('outsider', intent(gameId, 1, 'air')));
  await assert.rejects(service.advance(gameId, null, 'outsider'));
});
