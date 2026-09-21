import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, SYNC_WAIT_MS, AUTO_LOBBY_MS, CENTER_ITEM_TARGET, HAIR_ITEM_KIND, newGame, resolveRound, scheduleCenterItem, validateIntent, pruneLobby, phaseDeadline, allMarked, lobbyReturnSeconds } from '../src/game.js';
import { createServerClock, clockSample } from '../src/clock.js';

const members = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { name: `Jugador ${i}`, joinedAt: i, lastSeenAt: 1000, left: false }]));
const game = (count = 2) => {
  const state = newGame('room', members(count), 1000);
  state.phase = 'choosing';
  state.countdownEndsAt = null;
  state.deadline = 1000 + RULES.turnMs;
  return state;
};
const choice = (action, target = null, turn = 1) => ({ action, target, turn });

test('partida de 2 y 6 jugadores; límites y recursos iniciales', () => {
  for (const count of [2, 6]) {
    const state = game(count);
    assert.equal(state.memberIds.length, count);
    assert.equal(state.schemaVersion, 3);
    assert.equal(state.deadline, 9000);
    for (const p of Object.values(state.players)) assert.deepEqual([p.hair, p.breath], [3, 0]);
  }
  assert.throws(() => game(1)); assert.throws(() => game(7));
});
test('una partida nueva comienza con cuenta regresiva de 3 segundos', () => {
  const state = newGame('room', members(2), 1000);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.countdownEndsAt, 4000);
  assert.equal(state.deadline, 12000);
});

test('el regreso al lobby espera 3s y luego cuenta 5, 4, 3, 2, 1 hasta cero', () => {
  const state = { phase: 'finished', finishedAt: 10000 };
  assert.equal(AUTO_LOBBY_MS, 8000);
  assert.equal(lobbyReturnSeconds(state, 12999), null);
  assert.equal(lobbyReturnSeconds(state, 13000), 5);
  assert.equal(lobbyReturnSeconds(state, 14000), 4);
  assert.equal(lobbyReturnSeconds(state, 15000), 3);
  assert.equal(lobbyReturnSeconds(state, 16000), 2);
  assert.equal(lobbyReturnSeconds(state, 17000), 1);
  assert.equal(lobbyReturnSeconds(state, 18000), 0);
  assert.equal(lobbyReturnSeconds({ phase:'reveal', finishedAt:10000 }, 18000), null);
});
test('las posiciones usan el orden persistido y dejan al jugador local para el layout inferior', () => {
  const state = newGame('room', { z: { name: 'Z', joinedAt: 30 }, a: { name: 'A', joinedAt: 10 }, b: { name: 'B', joinedAt: 20 } }, 1000);
  assert.deepEqual(state.memberIds, ['a', 'b', 'z']);
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

test('reloj monotónico: cambiar fecha del dispositivo no adelanta ni retrasa el turno', () => {
  const epoch=Date.UTC(2026,8,17);
  let wall=epoch,tick=0;
  const clock=createServerClock(()=>wall,()=>tick);
  tick=50;clock.calibrate(epoch+100000,0,50);
  assert.equal(clock.now(),epoch+100025);
  wall+=3600000;tick+=1000;
  assert.equal(clock.now(),epoch+101025);
  wall-=7200000;tick+=1000;
  assert.equal(clock.now(),epoch+102025);
});

test('todas las pantallas usan el timestamp del servidor, no el deadline estimado del host', () => {
  const g=game();g.phaseStartedAt={toMillis:()=>50000};g.deadline=999999;
  assert.equal(phaseDeadline(g),58000);
  assert.throws(()=>validateIntent(g,'0',choice('air'),58000));
  assert.doesNotThrow(()=>validateIntent(g,'0',choice('air'),57999));
  g.phase='syncing';assert.equal(phaseDeadline(g),50000 + SYNC_WAIT_MS);
});

test('phaseDeadline normaliza Timestamp heredados sin mostrar milisegundos como segundos', () => {
  const g=game();g.protocolVersion=1;g.phase='reveal';g.nextTurnAt={toMillis:()=>Date.UTC(2026,8,17)+2500};
  assert.equal(phaseDeadline(g),Date.UTC(2026,8,17)+2500);
  g.phase='choosing';g.deadline={toMillis:()=>Date.UTC(2026,8,17)+8000};
  assert.equal(phaseDeadline(g),Date.UTC(2026,8,17)+8000);
  g.deadline=null;assert.equal(phaseDeadline(g),null);
});

test('confirmaciones: se requieren todos los activos, no los eliminados', () => {
  const g=game(3);g.chosen={'0':true,'1':true};
  assert.equal(allMarked(g,'chosen'),false);
  g.players['2'].hair=0;assert.equal(allMarked(g,'chosen'),true);
  g.chosen={};assert.equal(allMarked(g,'chosen'),false);
});

test('regresión: una hora de servidor vacía no convierte el contador en una fecha Unix', () => {
  const epoch=Date.UTC(2026,8,17), clock=createServerClock(()=>epoch,()=>1000);
  const g=game();g.phase='reveal';g.phaseStartedAt={toMillis:()=>epoch};
  const before=Math.ceil((phaseDeadline(g)-clock.now())/1000);
  // The old millis(null) => 0 path calibrated the clock near January 1970.
  clock.calibrate(0,900,1000);
  assert.equal(Math.ceil((phaseDeadline(g)-clock.now())/1000),before);
});

test('muestras de reloj: solo timestamps confirmados, sin caché ni escrituras pendientes', () => {
  const server=Date.UTC(2026,8,17);
  const snap=(clockAt,metadata={},exists=true)=>({
    exists:()=>exists, data:()=>({clockAt}),
    metadata:{fromCache:false,hasPendingWrites:false,...metadata},
  });
  const timestamp={toMillis:()=>server};
  assert.deepEqual(clockSample(snap(timestamp),10,20),{server,start:10,end:20,rtt:10});
  for(const value of [null,undefined,0,NaN,Infinity,'1789603200000',{}, {toMillis:()=>0}, {toMillis:()=>NaN}]) {
    assert.equal(clockSample(snap(value),10,20),null);
  }
  assert.equal(clockSample(snap(timestamp,{hasPendingWrites:true}),10,20),null);
  assert.equal(clockSample(snap(timestamp,{fromCache:true}),10,20),null);
  assert.equal(clockSample(snap(timestamp,{},false),10,20),null);
  assert.equal(clockSample(snap(timestamp),20,10),null);
});

test('recalibración inválida conserva la última hora válida y permite recuperarse', () => {
  const epoch=Date.UTC(2026,8,17);let tick=100;
  const clock=createServerClock(()=>epoch,()=>tick);
  assert.equal(clock.calibrate(epoch,0,100),true);
  tick+=1000;
  for(const bad of [null,undefined,0,NaN,Infinity,-1,'1789603200000']) {
    assert.equal(clock.calibrate(bad,1000,1100),false);
    assert.equal(clock.now(),epoch+1050);
  }
  assert.equal(clock.calibrate(epoch,200,100),false);
  assert.equal(clock.calibrate(epoch,NaN,100),false);
  assert.equal(clock.calibrate(epoch+2000,1050,1100),true);
  assert.equal(clock.now(),epoch+2025);
});


test('partidas nuevas habilitan objetos centrales raros sin alterar recursos iniciales', () => {
  const state = newGame('room', members(2), 1000);
  assert.equal(state.rules.centerItems, true);
  assert.equal(state.rules.itemFirstTurn, 4);
  assert.equal(state.rules.itemMinGap, 5);
  assert.equal(state.rules.itemCriticalForceGap, 7);
  assert.equal(state.rules.itemPityGap, 9);
  assert.equal(state.rules.itemSpawnChance, 0.18);
  assert.equal(state.rules.itemCriticalChance, 0.45);
  assert.equal(state.centerItem, null);
  assert.equal(state.lastItemSpawnTurn, 0);
  assert.equal(typeof state.itemSeed, 'string');
});

test('agarrar el mechón no requiere Soplos y Soplar al objeto ya no es válido', () => {
  const state = game();
  state.players['0'].breath = 0;
  assert.throws(() => validateIntent(state, '0', choice('grab', CENTER_ITEM_TARGET), 1001));
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'random' };
  assert.doesNotThrow(() => validateIntent(state, '0', choice('grab', CENTER_ITEM_TARGET), 1001));
  state.players['0'].breath = 1;
  assert.throws(() => validateIntent(state, '0', choice('blow', CENTER_ITEM_TARGET), 1001));
});

test('un solo jugador agarra el mechón gratis, recupera +1 Pelo y retira el objeto', () => {
  const state = game();
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'random' };
  state.players['0'].hair = 2;
  state.players['0'].breath = 0;
  const result = resolveRound(state, { 0: choice('grab', CENTER_ITEM_TARGET), 1: choice('hide') });
  assert.equal(result.players['0'].hair, 3);
  assert.equal(result.players['0'].breath, 0);
  assert.equal(result.centerItem, null);
  assert.equal(result.result.item.outcome, 'claimed');
  assert.equal(result.result.item.winnerId, '0');
  assert.equal(result.result.item.healed, 1);
  assert.equal(result.result.heals['0'], 1);
  assert.equal(result.result.actions['0'].action, 'grab');
});

test('ir por el mechón deja vulnerable: el daño entra antes de la curación', () => {
  const state = game();
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'critical' };
  state.players['0'].hair = 2;
  state.players['0'].breath = 0;
  state.players['1'].breath = 1;
  const result = resolveRound(state, {
    0: choice('grab', CENTER_ITEM_TARGET),
    1: choice('blow', '0'),
  });
  assert.equal(result.result.hits[0].blocked, false);
  assert.equal(result.result.losses['0'], 1);
  assert.equal(result.result.heals['0'], 1);
  assert.equal(result.players['0'].hair, 2);
  assert.equal(result.players['0'].breath, 0);
});

test('si queda en 0 Pelo mientras va por el mechón, no revive', () => {
  const state = game();
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'critical' };
  state.players['0'].hair = 1;
  state.players['0'].breath = 0;
  state.players['1'].breath = 1;
  const result = resolveRound(state, {
    0: choice('grab', CENTER_ITEM_TARGET),
    1: choice('blow', '0'),
  });
  assert.equal(result.players['0'].hair, 0);
  assert.equal(result.result.losses['0'], 1);
  assert.equal(result.result.heals['0'], undefined);
  assert.equal(result.result.item.outcome, 'claimed');
  assert.equal(result.result.item.claimantAlive, false);
  assert.equal(result.centerItem, null);
});

test('dos o más jugadores que van por el mechón no gastan Soplos y nadie cura', () => {
  const state = game();
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'random' };
  state.players['0'].hair = 2;
  state.players['1'].hair = 2;
  state.players['0'].breath = 1;
  state.players['1'].breath = 0;
  const result = resolveRound(state, {
    0: choice('grab', CENTER_ITEM_TARGET),
    1: choice('grab', CENTER_ITEM_TARGET),
  });
  assert.equal(result.centerItem, null);
  assert.equal(result.result.item.outcome, 'contested');
  assert.equal(result.result.item.attempts.length, 2);
  assert.deepEqual(result.result.heals, {});
  assert.equal(result.players['0'].hair, 2);
  assert.equal(result.players['1'].hair, 2);
  assert.equal(result.players['0'].breath, 1);
  assert.equal(result.players['1'].breath, 0);
});

test('si nadie intenta obtenerlo, el mechón permanece para el turno siguiente', () => {
  const state = game();
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'random' };
  const result = resolveRound(state, { 0: choice('air'), 1: choice('hide') });
  assert.deepEqual(result.centerItem, state.centerItem);
  assert.equal(result.result.item.outcome, 'stayed');
});

test('los items no aparecen antes de la ronda 4 y la aparición base puede no ocurrir', () => {
  const state = game();
  state.rules.itemSpawnChance = 0;
  state.rules.itemCriticalChance = 0;
  for (const turn of [2, 3, 4, 5, 6, 7, 8]) {
    const scheduled = scheduleCenterItem(state, turn);
    assert.equal(scheduled.centerItem, null);
  }
});

test('el pity tardío evita una sequía infinita sin volver frecuente al evento', () => {
  const state = game();
  state.rules.itemSpawnChance = 0;
  state.rules.itemCriticalChance = 0;
  const before = scheduleCenterItem(state, 8);
  assert.equal(before.centerItem, null);
  const pity = scheduleCenterItem(state, 9);
  assert.equal(pity.centerItem.kind, HAIR_ITEM_KIND);
  assert.equal(pity.centerItem.source, 'pity');
  assert.equal(pity.lastItemSpawnTurn, 9);
});

test('la lectura de HP aumenta la chance pero respeta el cooldown entre items', () => {
  const state = game();
  state.players['0'].hair = 1;
  state.players['1'].hair = 3;
  state.rules.itemCriticalChance = 1;
  state.rules.itemSpawnChance = 0;
  const critical = scheduleCenterItem(state, 4);
  assert.equal(critical.centerItem.kind, HAIR_ITEM_KIND);
  assert.equal(critical.centerItem.source, 'critical');

  state.lastItemSpawnTurn = 4;
  for (const turn of [5, 6, 7, 8]) {
    const scheduled = scheduleCenterItem(state, turn);
    assert.equal(scheduled.centerItem, null);
  }
});

test('una sequía larga con desventaja crítica fuerza el mechón antes del pity', () => {
  const state = game();
  state.players['0'].hair = 1;
  state.players['1'].hair = 3;
  state.rules.itemCriticalChance = 0;
  state.rules.itemSpawnChance = 0;
  const before = scheduleCenterItem(state, 6);
  assert.equal(before.centerItem, null);
  const forced = scheduleCenterItem(state, 7);
  assert.equal(forced.centerItem.kind, HAIR_ITEM_KIND);
  assert.equal(forced.centerItem.source, 'critical');
});

test('aparición normal sigue siendo determinista entre hosts', () => {
  const state = game();
  state.players['0'].hair = state.players['1'].hair = 3;
  const a = scheduleCenterItem(state, 7);
  const b = scheduleCenterItem(structuredClone(state), 7);
  assert.deepEqual(a, b);
});

test('un objeto existente bloquea nuevos spawns', () => {
  const state = game();
  state.centerItem = { kind: HAIR_ITEM_KIND, spawnedTurn: 4, source: 'random' };
  state.lastItemSpawnTurn = 4;
  const scheduled = scheduleCenterItem(state, 10);
  assert.deepEqual(scheduled.centerItem, state.centerItem);
  assert.equal(scheduled.lastItemSpawnTurn, 4);
});

test('cooldown del item empieza cuando sale del escritorio aunque haya quedado varios turnos', () => {
  const state = game();
  state.turn = 8;
  state.centerItem = null;
  state.lastItemSpawnTurn = 4;
  state.lastResult = { item: { kind: HAIR_ITEM_KIND, outcome: 'claimed', attempts: ['0'], winnerId: '0', healed: 1, spawnedTurn: 4 } };
  const afterClaim = scheduleCenterItem(state, 9);
  assert.equal(afterClaim.centerItem, null);
  assert.equal(afterClaim.lastItemSpawnTurn, 8);

  state.turn = 9;
  state.lastResult = { item: null };
  state.lastItemSpawnTurn = afterClaim.lastItemSpawnTurn;
  const oneMoreRound = scheduleCenterItem(state, 10);
  assert.equal(oneMoreRound.centerItem, null);
  assert.equal(oneMoreRound.lastItemSpawnTurn, 8);
});
