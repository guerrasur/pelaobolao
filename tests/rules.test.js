import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, collection } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-pelaobolao', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'profiles/alice'), { schemaVersion: 1, name: 'Alice' });
    await setDoc(doc(db, 'sessions/alice'), { roomId: 'safe-room' });
    await setDoc(doc(db, 'rooms/safe-room'), { members: { alice: {}, bob: {} } });
    await setDoc(doc(db, 'games/safe-game'), { memberIds: ['alice', 'bob'], players: { alice: { hair: 3 } } });
    await setDoc(doc(db, 'games/safe-game/intents/alice'), { action: 'hide', turn: 1 });
    await setDoc(doc(db, 'games/safe-game/intents/bob'), { action: 'air', turn: 1 });
    await setDoc(doc(db, 'games/safe-game/rounds/1'), { turn: 1 });
  });
});
after(async () => { await env.cleanup(); });
test('solo el propietario lee su perfil, sesión e intención', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertSucceeds(getDoc(doc(db, 'profiles/alice')));
  await assertSucceeds(getDoc(doc(db, 'sessions/alice')));
  await assertSucceeds(getDoc(doc(db, 'games/safe-game/intents/alice')));
  await assertFails(getDoc(doc(db, 'profiles/bob')));
  await assertFails(getDoc(doc(db, 'sessions/bob')));
  await assertFails(getDoc(doc(db, 'games/safe-game/intents/bob')));
  await assertFails(getDocs(collection(db, 'games/safe-game/intents')));
});
test('miembros ven el estado público y resultados; ajenos no', async () => {
  for (const uid of ['alice', 'bob']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, 'rooms/safe-room')));
    await assertSucceeds(getDoc(doc(db, 'games/safe-game')));
    await assertSucceeds(getDoc(doc(db, 'games/safe-game/rounds/1')));
  }
  for (const db of [env.authenticatedContext('outsider').firestore(), env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'rooms/safe-room')));
    await assertFails(getDoc(doc(db, 'games/safe-game')));
    await assertFails(getDoc(doc(db, 'games/safe-game/intents/alice')));
    await assertFails(getDoc(doc(db, 'games/safe-game/rounds/1')));
  }
});
test('ni el dueño escribe estado, intenciones, identidad, progreso o tareas directamente', async () => {
  const db = env.authenticatedContext('alice').firestore();
  for (const path of ['profiles/alice', 'progress/alice', 'sessions/alice', 'rooms/safe-room', 'roomCodes/ABC234',
    'games/safe-game', 'games/safe-game/intents/alice', 'games/safe-game/rounds/1', 'jobs/fake']) {
    await assertFails(setDoc(doc(db, path), { hair: 999, hostId: 'alice' }));
  }
  await assertFails(getDocs(collection(db, 'rooms')));
});
