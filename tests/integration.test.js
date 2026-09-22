import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, updateDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { createClient } from '../src/client.js';
import { LOBBY_LEASE_MS, CENTER_ITEM_TARGET, HAIR_ITEM_KIND } from '../src/game.js';
let env, seq = 0;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-pelaobolao', firestore: { rules: await readFile('firestore.rules','utf8') } });
});
after(async () => env.cleanup());
const read = async (db,path) => (await getDoc(doc(db,path))).data();
const seed = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const patch = (path,data) => seed(db => updateDoc(doc(db,path),data));
async function pair(count=2) {
  const players = [];
  for(let i=0;i<count;i++) {
    const uid = `p${++seq}`, db = env.authenticatedContext(uid).firestore(), client = createClient(db,uid);
    await client.call('saveProfile',{name:uid}); players.push({uid,db,client});
  }
  const [a,b] = players;
  const {roomId} = await a.client.call('roomCommand',{command:'create'});
  for(const p of players.slice(1)) await p.client.call('roomCommand',{command:'join',code:roomId});
  return {a,b,players,roomId};
}
async function started(count=2) {
  const p=await pair(count);
  for(const player of p.players) await player.client.call('roomCommand',{command:'ready',roomId:p.roomId,ready:true});
  await p.a.client.call('roomCommand',{command:'start',roomId:p.roomId});
  const gameId=(await read(p.a.db,`rooms/${p.roomId}`)).gameId;
  await patch(`games/${gameId}`,{countdownEndsAt:Date.now()-5000,phaseStartedAt:Timestamp.fromMillis(Date.now()-5000),'rules.turnMs':60000});
  for (const player of p.players) await player.client.call('acknowledgeRound',{gameId,turn:1});
  await p.a.client.call('advanceGame',{gameId,turn:1,phase:'countdown'});
  return {...p,gameId};
}
const choose = (p,gameId,turn,action,target=null,revision=0,requestId=crypto.randomUUID()) =>
  p.client.call('submitIntent',{gameId,turn,action,target,expectedRevision:revision,requestId});
async function advance(p, gameId, { acknowledge = true } = {}) {
  const g=await read(p.db,`games/${gameId}`);
  await expire(gameId, g.phase === 'choosing' ? g.rules.turnMs : g.rules.revealMs);
  const result = await p.client.call('advanceGame',{gameId,turn:g.turn,phase:g.phase});
  if (g.phase === 'reveal') {
    await patch(`games/${gameId}`,{phaseStartedAt:Timestamp.fromMillis(Date.now()-20000)});
    if (acknowledge) {
      for (const player of p.players ?? [p]) {
        await player.client.call('acknowledgeRound',{gameId,turn:g.turn+1});
      }
    }
    await p.client.call('advanceGame',{gameId,turn:g.turn+1,phase:'syncing'});
  }
  return result;
}
const expire = (gameId, duration=60000) => patch(`games/${gameId}`, {
  deadline:Date.now()-5000, nextTurnAt:Date.now()-5000,
  phaseStartedAt:Timestamp.fromMillis(Date.now()-duration-5000),
});
test('inicio único ante concurrencia y solo host inicia',async()=>{
  const {a,b,roomId}=await pair();
  await assert.rejects(b.client.call('roomCommand',{command:'start',roomId}));
  await a.client.call('roomCommand',{command:'ready',roomId,ready:true});
  await b.client.call('roomCommand',{command:'ready',roomId,ready:true});
  const starts=await Promise.allSettled([a.client.call('roomCommand',{command:'start',roomId}),a.client.call('roomCommand',{command:'start',roomId})]);
  assert.ok(starts.some(result=>result.status==='fulfilled'));
  await seed(async db => assert.equal((await getDocs(collection(db,'games'))).docs.filter(d=>d.data().roomId===roomId).length,1));
});
test('un jugador listo pero vencido no entra a la partida nueva',async()=>{
  const {a,players,roomId}=await pair(3);
  for(const player of players) await player.client.call('roomCommand',{command:'ready',roomId,ready:true});
  const stale=players[2];
  await patch(`rooms/${roomId}`,{[`members.${stale.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-LOBBY_LEASE_MS-5000)});
  await a.client.syncClock();
  await a.client.call('roomCommand',{command:'start',roomId});
  const room=await read(a.db,`rooms/${roomId}`);
  const game=await read(a.db,`games/${room.gameId}`);
  assert.equal(room.members[stale.uid],undefined);
  assert.equal(game.memberIds.includes(stale.uid),false);
  assert.equal(game.memberIds.length,2);
});

test('cambio secreto, replay, revisión obsoleta y cierre de intenciones',async()=>{
  const {a,b,gameId}=await started();
  const requestId=crypto.randomUUID();
  const receipts=await Promise.all([choose(a,gameId,1,'air',null,0,requestId),choose(a,gameId,1,'air',null,0,requestId)]);
  assert.equal(receipts[0].revision,1);assert.equal(receipts[1].revision,1);
  await choose(a,gameId,1,'hide',null,1);
  await assert.rejects(choose(a,gameId,1,'air',null,0));
  assert.equal((await read(a.db,`games/${gameId}`)).players[a.uid].breath,0);
  await choose(b,gameId,1,'air');
  await assert.rejects(getDoc(doc(a.db,`games/${gameId}/intents/${b.uid}`)));
  await expire(gameId);
  await assert.rejects(choose(a,gameId,1,'air',null,2));
});
test('seis jugadores, resoluciones concurrentes y repetidas no duplican daño ni resultados',async()=>{
  const {a,b,players,gameId}=await started(6);
  await patch(`games/${gameId}`,Object.fromEntries(players.map(p=>[`players.${p.uid}.breath`,1])));
  for(const p of players) await choose(p,gameId,1,'blow',p===b?a.uid:b.uid);
  await expire(gameId);
  await assert.rejects(b.client.call('advanceGame',{gameId,turn:1,phase:'choosing'}));
  const attempts=await Promise.allSettled(Array.from({length:5},()=>a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'})));
  const results=attempts.filter(result=>result.status==='fulfilled').map(result=>result.value);
  assert.equal(results.filter(r=>r.advanced).length,1);
  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.resolvedTurn,1);assert.equal(g.players[a.uid].hair,2);assert.equal(g.players[b.uid].hair,0);
  for(const p of players) assert.equal(g.players[p.uid].breath,0);
  assert.equal((await getDocs(collection(a.db,`games/${gameId}/rounds`))).size,1);
  await advance(a,gameId);
  assert.equal((await read(a.db,`games/${gameId}`)).turn,2);
  assert.equal((await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'})).advanced,false);
});
test('partida completa, ganador, revancha y perfil persistente intacto',async()=>{
  const {a,b,gameId,roomId}=await started();
  const old=await read(a.db,`profiles/${a.uid}`);
  for(let t=1;t<=6;t++) {
    await choose(a,gameId,t,t%2?'air':'blow',t%2?null:b.uid);
    await advance(a,gameId);if(t<6) await advance(a,gameId);
  }
  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.winnerId,a.uid);assert.equal(g.phase,'finished');
  assert.deepEqual(await read(a.db,`profiles/${a.uid}`),old);
  await a.client.call('roomCommand',{command:'lobby',roomId});
  const rematchLobby=await read(a.db,`rooms/${roomId}`);
  assert.ok(Object.values(rematchLobby.members).every(member=>member.ready===false));
  await assert.rejects(a.client.call('roomCommand',{command:'start',roomId}));
  for(const player of [a,b]) await player.client.call('roomCommand',{command:'ready',roomId,ready:true});
  await a.client.call('roomCommand',{command:'start',roomId});
  assert.notEqual((await read(a.db,`rooms/${roomId}`)).gameId,gameId);
});
test('al terminar, un jugador puede relevar al host caído con el lease corto',async()=>{
  const {a,b,gameId,roomId}=await started();
  await patch(`games/${gameId}`,{phase:'finished',finishedAt:Date.now()-6000,lastProgressAt:Timestamp.fromMillis(Date.now()),winnerId:a.uid});
  await patch(`rooms/${roomId}`,{status:'finished',[`members.${a.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-10000)});
  await b.client.call('roomCommand',{command:'touch',roomId});
  assert.equal((await read(b.db,`rooms/${roomId}`)).hostId,b.uid);
});

test('host sale del lobby: transferencia y reingreso',async()=>{
  const {a,b,roomId}=await pair();
  await a.client.call('roomCommand',{command:'leave',roomId});
  assert.equal((await read(b.db,`rooms/${roomId}`)).hostId,b.uid);
  await a.client.call('roomCommand',{command:'join',code:roomId});
  assert.equal((await read(a.db,`sessions/${a.uid}`)).roomId,roomId);
});
test('perfil recordado se puede reconfirmar, renombrar en lobby y limpiar una sesión obsoleta',async()=>{
  const {a,roomId}=await pair();
  await a.client.call('saveProfile',{name:'Nombre nuevo'});
  await a.client.call('roomCommand',{command:'rename',roomId});
  assert.equal((await read(a.db,`rooms/${roomId}`)).members[a.uid].name,'Nombre nuevo');
  await a.client.call('clearRoomSession',{});
  assert.equal((await read(a.db,`sessions/${a.uid}`)).roomId,null);
});
test('host desconectado durante partida: elección concurrente, antiguo host rechazado y turno intacto',async()=>{
  const {a,b,players,gameId,roomId}=await started(3);
  await choose(a,gameId,1,'air');
  await patch(`rooms/${roomId}`,{[`members.${a.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-60000)});
  await players[1].client.call('roomCommand',{command:'touch',roomId});
  for(const p of players.slice(2)) await p.client.call('roomCommand',{command:'touch',roomId});
  const r=await read(b.db,`rooms/${roomId}`), host=players.find(p=>p.uid===r.hostId);
  assert.notEqual(host.uid,a.uid);
  await expire(gameId);
  await assert.rejects(a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'}));
  await host.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});
  assert.equal((await read(host.db,`games/${gameId}`)).players[a.uid].breath,1);
  await a.client.call('roomCommand',{command:'touch',roomId});
  assert.equal((await read(b.db,`rooms/${roomId}`)).hostId,host.uid);
});
test('salida explícita de una partida la cierra para todos',async()=>{
  const {a,b,gameId,roomId}=await started();
  await a.client.call('roomCommand',{command:'leave',roomId});
  const room = await read(b.db,`rooms/${roomId}`), game = await read(b.db,`games/${gameId}`);
  assert.equal(room.status,'closed'); assert.equal(room.gameId,null);
  assert.equal(game.phase,'abandoned');
  assert.equal((await b.client.call('advanceGame',{gameId,turn:1,phase:'countdown'})).advanced,false);
});

test('partida congelada durante horas se retira y limpia la sala',async()=>{
  const {a,b,gameId,roomId}=await started();
  await patch(`games/${gameId}`,{lastProgressAt:Timestamp.fromMillis(Date.now()-180000)});
  await a.client.call('abandonGame',{gameId});
  assert.equal((await read(a.db,`games/${gameId}`)).phase,'abandoned');
  assert.equal((await read(b.db,`rooms/${roomId}`)).status,'closed');
  assert.equal((await read(b.db,`rooms/${roomId}`)).gameId,null);
});

test('partida terminada vieja se retira sin reabrir la revancha',async()=>{
  const {a,b,gameId,roomId}=await started();
  await patch(`games/${gameId}`,{phase:'finished',lastProgressAt:Timestamp.fromMillis(Date.now()-180000),finishedAt:Date.now()});
  await a.client.call('abandonGame',{gameId});
  const game=await read(a.db,`games/${gameId}`),room=await read(b.db,`rooms/${roomId}`);
  assert.equal(game.phase,'finished');assert.equal(room.status,'closed');assert.equal(room.gameId,null);
});

test('limpiar una sesión vieja no borra la sala nueva',async()=>{
  const {a,b,roomId}=await pair();
  await a.client.call('roomCommand',{command:'leave',roomId});
  const next=await a.client.call('roomCommand',{command:'create'});
  await a.client.call('clearRoomSession',{roomId});
  assert.equal((await read(a.db,`sessions/${a.uid}`)).roomId,next.roomId);
  await a.client.call('clearRoomSession',{roomId:next.roomId});
  assert.equal((await read(a.db,`sessions/${a.uid}`)).roomId,null);
});

test('cierre anticipado: espera a todos, congela acciones y resuelve una sola vez', async () => {
  const {a,b,gameId}=await started();
  await choose(a,gameId,1,'air');
  assert.equal((await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'})).advanced,false);
  await assert.rejects(getDoc(doc(a.db,`games/${gameId}/intents/${b.uid}`)));
  await choose(b,gameId,1,'hide');
  await assert.rejects(choose(a,gameId,1,'hide',null,1));
  await assert.rejects(getDoc(doc(a.db,`games/${gameId}/intents/${b.uid}`)));
  assert.equal((await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'})).advanced,true);
  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.phase,'reveal');assert.equal(g.players[a.uid].breath,1);
  assert.equal(g.lastResult.actions[b.uid].action,'hide');
  assert.equal((await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'})).advanced,false);
});

test('el siguiente turno arranca desde el timestamp del servidor sin una barrera de ACK', async () => {
  const {a,b,gameId}=await started();
  await choose(a,gameId,1,'air'); await choose(b,gameId,1,'hide');
  await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});
  await expire(gameId,2500);
  assert.equal((await a.client.call('advanceGame',{gameId,turn:1,phase:'reveal'})).advanced,true);
  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.turn,2); assert.equal(g.phase,'choosing');
  assert.ok(Date.now()-g.phaseStartedAt.toMillis()<2000);
  assert.deepEqual(g.chosen,{});
  await choose(a,gameId,2,'air');
});

test('reglas nuevas: no se pueden falsificar confirmaciones, cierre ni elecciones ajenas', async () => {
  const {a,b,gameId}=await started();
  const ref=doc(a.db,`games/${gameId}`);
  await assert.rejects(updateDoc(ref,{[`chosen.${b.uid}`]:true}));
  await assert.rejects(updateDoc(ref,{[`chosen.${a.uid}`]:true}));
  await assert.rejects(updateDoc(ref,{phase:'locked'}));
  await assert.rejects(updateDoc(ref,{phaseStartedAt:serverTimestamp()}));
  await assert.rejects(setDoc(doc(a.db,`games/${gameId}/intents/${a.uid}`),{
    turn:1,action:'air',target:null,requestId:'uncoupled',revision:1,submittedAt:serverTimestamp(),
  }));
  await advance(a,gameId);await expire(gameId,2500);
  await a.client.call('advanceGame',{gameId,turn:1,phase:'reveal'});
  await assert.rejects(updateDoc(ref,{[`ready.${b.uid}`]:true}));
  await assert.rejects(updateDoc(ref,{phase:'choosing',phaseStartedAt:serverTimestamp()}));
});

test('jugador eliminado no bloquea cierre y un host nuevo recupera la fase bloqueada', async () => {
  const {a,b,players,gameId,roomId}=await started(3);
  await patch(`games/${gameId}`,{[`players.${players[2].uid}.hair`]:0});
  await choose(a,gameId,1,'air');await choose(b,gameId,1,'hide');
  await updateDoc(doc(a.db,`games/${gameId}`),{phase:'locked',lastProgressAt:serverTimestamp()});
  await assert.rejects(choose(b,gameId,1,'air',null,1));
  await a.client.call('roomCommand',{command:'leave',roomId});
  assert.equal((await b.client.call('advanceGame',{gameId,turn:1,phase:'locked'})).advanced,false);
  assert.equal((await read(b.db,`games/${gameId}`)).phase,'abandoned');
  assert.equal((await read(b.db,`rooms/${roomId}`)).status,'closed');
});

test('calibración real corrige una hora de desfase y conserva la sesión', async () => {
  const {a,roomId}=await pair();
  const skewed=createClient(a.db,a.uid,()=>Date.now()+3600000);
  assert.ok(skewed.now()-Date.now()>3500000);
  await skewed.syncClock();
  assert.ok(Math.abs(skewed.now()-Date.now())<1500);
  await skewed.syncClock();
  assert.ok(Math.abs(skewed.now()-Date.now())<1500);
  assert.equal((await read(a.db,`sessions/${a.uid}`)).roomId,roomId);
});

test('dos clientes de la misma identidad sincronizan sin llevar el reloj a cero', async () => {
  const {a}=await pair();
  const other=createClient(env.authenticatedContext(a.uid).firestore(),a.uid);
  for(let attempt=0;attempt<2;attempt++) {
    // Unconfirmed samples may be rejected; an already valid local clock is retained.
    await Promise.allSettled([a.client.syncClock(),other.syncClock()]);
    for(const client of [a.client,other]) assert.ok(Math.abs(client.now()-Date.now())<1500);
  }
});

 test('crear sala no recupera la anterior y una salida vieja no borra la nueva sesión', async () => {
  const { a, roomId } = await pair();
  const next = await a.client.call('roomCommand', { command: 'create' });
  assert.notEqual(next.roomId, roomId);
  await a.client.call('roomCommand', { command: 'leave', roomId });
  assert.equal((await read(a.db, `sessions/${a.uid}`)).roomId, next.roomId);
});


test('regresión: reveal cambia turn y llega al turno 2 con las reglas desplegadas', async () => {
  const {a,b,gameId}=await started();
  await choose(a,gameId,1,'air'); await choose(b,gameId,1,'hide');
  await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});
  assert.equal((await read(a.db,`games/${gameId}`)).phase,'reveal');
  await expire(gameId,2500);
  await a.client.call('advanceGame',{gameId,turn:1,phase:'reveal'});
  const next=await read(b.db,`games/${gameId}`);
  assert.equal(next.turn,2); assert.equal(next.phase,'choosing');
  // Allowing turn in the outer field list must not allow arbitrary turn skipping.
  await assert.rejects(updateDoc(doc(a.db,`games/${gameId}`),{turn:99}));
});

test('host suspendido: relevo rápido sin expulsar a nadie', async () => {
  const {a,b,roomId,gameId}=await started();
  await assert.rejects(updateDoc(doc(b.db,`rooms/${roomId}`),{hostId:b.uid,updatedAt:serverTimestamp()}));
  await patch(`rooms/${roomId}`,{[`members.${a.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-10000)});
  await b.client.call('roomCommand',{command:'touch',roomId});
  const r=await read(b.db,`rooms/${roomId}`);
  assert.equal(r.hostId,b.uid); assert.equal(r.members[a.uid].left,false);
  await choose(a,gameId,1,'air'); await choose(b,gameId,1,'hide');
  await b.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});
  assert.equal((await read(a.db,`games/${gameId}`)).phase,'reveal');
  await a.client.call('roomCommand',{command:'touch',roomId});
  assert.equal((await read(a.db,`rooms/${roomId}`)).hostId,b.uid);
});

test('listos y latidos concurrentes conservan a los seis jugadores sin denegar permisos', async () => {
  const { a, players, roomId } = await pair(6);
  await Promise.all(players.map(p => p.client.call('roomCommand', { command: 'ready', roomId, ready: true })));
  await Promise.all(players.map(p => p.client.call('roomCommand', { command: 'touch', roomId })));
  const room = await read(a.db, `rooms/${roomId}`);
  assert.equal(Object.keys(room.members).length, 6);
  assert.ok(Object.values(room.members).every(m => m.ready && !m.left));
});


test('Plan Aguila: late joiners spectate safely and enter the next lobby', async () => {
  const {a,b,gameId,roomId}=await started();
  const makeSpectator=async label => {
    const uid=`${label}${++seq}`, db=env.authenticatedContext(uid).firestore(), client=createClient(db,uid);
    await client.call('saveProfile',{name:uid});
    await client.call('roomCommand',{command:'join',code:roomId});
    return {uid,db,client};
  };
  const watcher=await makeSpectator('watcher');
  const leavingWatcher=await makeSpectator('leaver');

  const activeRoom=await read(watcher.db,`rooms/${roomId}`);
  const activeGame=await read(watcher.db,`games/${gameId}`);
  assert.equal(activeRoom.status,'playing');
  assert.equal(activeGame.memberIds.includes(watcher.uid),false);
  assert.equal(activeGame.memberIds.includes(leavingWatcher.uid),false);
  await assert.rejects(choose(watcher,gameId,1,'air'));

  await leavingWatcher.client.call('roomCommand',{command:'leave',roomId});
  const afterSpectatorLeave=await read(b.db,`rooms/${roomId}`);
  assert.equal(afterSpectatorLeave.status,'playing');
  assert.equal(afterSpectatorLeave.gameId,gameId);
  assert.equal(afterSpectatorLeave.members[leavingWatcher.uid],undefined);
  assert.notEqual((await read(b.db,`games/${gameId}`)).phase,'abandoned');

  await patch(`rooms/${roomId}`,{[`members.${a.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-10000)});
  await watcher.client.call('roomCommand',{command:'touch',roomId});
  assert.equal((await read(watcher.db,`rooms/${roomId}`)).hostId,a.uid);
  await b.client.call('roomCommand',{command:'touch',roomId});
  assert.equal((await read(watcher.db,`rooms/${roomId}`)).hostId,b.uid);

  await patch(`games/${gameId}`,{
    phase:'finished',winnerId:b.uid,draw:false,finishedAt:Date.now(),
    lastProgressAt:Timestamp.fromMillis(Date.now()),
  });
  await patch(`rooms/${roomId}`,{status:'finished'});
  await b.client.call('roomCommand',{command:'lobby',roomId});

  const lobby=await read(watcher.db,`rooms/${roomId}`);
  assert.equal(lobby.status,'lobby');
  assert.equal(lobby.gameId,null);
  assert.ok(lobby.members[watcher.uid]);
  assert.equal(lobby.members[watcher.uid].ready,false);
  assert.equal(lobby.members[leavingWatcher.uid],undefined);
});


test('Plan Condor: el host limpia espectadores tardíos vencidos sin tocar participantes ni la partida', async () => {
  const {a,b,gameId,roomId}=await started();
  const uid=`stale-watcher-${++seq}`;
  const db=env.authenticatedContext(uid).firestore();
  const client=createClient(db,uid);
  await client.call('saveProfile',{name:'Espectador'});
  await client.call('roomCommand',{command:'join',code:roomId});
  assert.ok((await read(a.db,`rooms/${roomId}`)).members[uid]);

  await patch(`rooms/${roomId}`,{[`members.${uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-LOBBY_LEASE_MS-5000)});
  await a.client.call('roomCommand',{command:'touch',roomId});

  const room=await read(a.db,`rooms/${roomId}`);
  const game=await read(a.db,`games/${gameId}`);
  assert.equal(room.members[uid],undefined);
  assert.ok(room.members[a.uid]);
  assert.ok(room.members[b.uid]);
  assert.equal(room.status,'playing');
  assert.equal(room.gameId,gameId);
  assert.notEqual(game.phase,'abandoned');
});


test('Plan Aguila 0.17: Agarrar +1 Pelo es gratis, vulnerable y se resuelve en Firestore', async () => {
  const {a,b,gameId}=await started();
  await patch(`games/${gameId}`,{
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:1,source:'test'},
    [`players.${a.uid}.hair`]:2,
  });
  await choose(a,gameId,1,'grab',CENTER_ITEM_TARGET);
  await choose(b,gameId,1,'hide');
  await expire(gameId);
  await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});

  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.phase,'reveal');
  assert.equal(g.players[a.uid].hair,3);
  assert.equal(g.players[a.uid].breath,0);
  assert.equal(g.centerItem,null);
  assert.equal(g.lastResult.actions[a.uid].action,'grab');
  assert.equal(g.lastResult.item.outcome,'claimed');
  assert.equal(g.lastResult.item.winnerId,a.uid);
  assert.equal(g.lastResult.heals[a.uid],1);
  const round=await read(a.db,`games/${gameId}/rounds/1`);
  assert.equal(round.item.outcome,'claimed');
  assert.equal(round.heals[a.uid],1);
});

test('Plan Aguila 0.17: el director no fuerza items críticos demasiado temprano', async () => {
  const {a,b,gameId}=await started();
  await patch(`games/${gameId}`,{
    [`players.${a.uid}.hair`]:1,
    [`players.${b.uid}.hair`]:3,
  });
  await choose(a,gameId,1,'hide');
  await choose(b,gameId,1,'hide');
  await expire(gameId);
  await a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});
  await expire(gameId,2500);
  await a.client.call('advanceGame',{gameId,turn:1,phase:'reveal'});

  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.turn,2);
  assert.equal(g.phase,'choosing');
  assert.equal(g.centerItem,null);
  assert.equal(g.lastItemSpawnTurn,0);
});


test('Plan Condor: una partida protocol v1 puede pasar de reveal al turno siguiente después de agregar items', async () => {
  const {a,gameId}=await started();
  await patch(`games/${gameId}`,{
    protocolVersion:1,
    phase:'reveal',
    turn:1,
    resolvedTurn:1,
    nextTurnAt:Date.now()-5000,
    deadline:Date.now()-5000,
    phaseStartedAt:Timestamp.fromMillis(Date.now()-5000),
    centerItem:null,
    lastItemSpawnTurn:0,
  });
  const result=await a.client.call('advanceGame',{gameId,turn:1,phase:'reveal'});
  assert.equal(result.advanced,true);
  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.phase,'choosing');
  assert.equal(g.turn,2);
  assert.ok(Object.prototype.hasOwnProperty.call(g,'centerItem'));
  assert.ok(Object.prototype.hasOwnProperty.call(g,'lastItemSpawnTurn'));
});


test('Plan Cóndor stress: 2, 3, 4 y 6 jugadores sostienen rondas concurrentes sin duplicar ni trabar turnos', async () => {
  for (const count of [2, 3, 4, 6]) {
    const { a, players, gameId, roomId } = await started(count);
    for (let turn = 1; turn <= 4; turn++) {
      const before = await read(a.db, `games/${gameId}`);
      assert.equal(before.phase, 'choosing');
      assert.equal(before.turn, turn);

      const submissions = players.map((player, index) => {
        const action = (turn + index) % 2 === 0 ? 'air' : 'hide';
        return choose(player, gameId, turn, action);
      });
      const heartbeatBursts = players.map(player =>
        player.client.call('roomCommand', { command: 'touch', roomId }));
      await Promise.all([...submissions, ...heartbeatBursts]);

      const chosen = await read(a.db, `games/${gameId}`);
      assert.equal(chosen.turn, turn);
      assert.equal(chosen.phase, 'choosing');
      for (const player of players) {
        assert.equal(chosen.chosen[player.uid], true);
        const ownIntent = await read(player.db, `games/${gameId}/intents/${player.uid}`);
        assert.equal(ownIntent.turn, turn);
        assert.equal(ownIntent.revision, 1);
      }

      const resolutionRace = await Promise.allSettled([
        a.client.call('advanceGame', { gameId, turn, phase: 'choosing' }),
        a.client.call('advanceGame', { gameId, turn, phase: 'choosing' }),
        a.client.call('advanceGame', { gameId, turn, phase: 'choosing' }),
        ...players.map(player => player.client.call('roomCommand', { command: 'touch', roomId })),
      ]);
      const resolutionResults = resolutionRace.slice(0, 3)
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
      assert.equal(resolutionResults.filter(result => result.advanced).length, 1);

      const resolved = await read(a.db, `games/${gameId}`);
      assert.equal(resolved.phase, 'reveal');
      assert.equal(resolved.resolvedTurn, turn);
      assert.equal(resolved.lastResult.turn, turn);
      for (const player of Object.values(resolved.players)) {
        assert.ok(player.hair >= 0 && player.hair <= resolved.rules.maxHair);
        assert.ok(player.breath >= 0 && player.breath <= resolved.rules.maxBreath);
      }
      assert.equal((await getDocs(collection(a.db, `games/${gameId}/rounds`))).size, turn);
      assert.equal((await a.client.call('advanceGame', { gameId, turn, phase: 'choosing' })).advanced, false);

      await expire(gameId, resolved.rules.revealMs);
      const revealRace = await Promise.allSettled([
        a.client.call('advanceGame', { gameId, turn, phase: 'reveal' }),
        a.client.call('advanceGame', { gameId, turn, phase: 'reveal' }),
        ...players.map(player => player.client.call('roomCommand', { command: 'touch', roomId })),
      ]);
      const revealResults = revealRace.slice(0, 2)
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
      assert.equal(revealResults.filter(result => result.advanced).length, 1);

      const next = await read(a.db, `games/${gameId}`);
      assert.equal(next.phase, 'choosing');
      assert.equal(next.turn, turn + 1);
      assert.deepEqual(next.chosen, {});
    }
  }
});


test('si alguien no elige, el deadline resuelve como Distraído sin trabar al resto', async () => {
  const { a, players, gameId } = await started(4);
  await choose(players[0], gameId, 1, 'air');
  await choose(players[1], gameId, 1, 'hide');
  await choose(players[2], gameId, 1, 'air');
  // players[3] deja vencer el turno sin enviar intención.
  await expire(gameId);
  assert.equal((await a.client.call('advanceGame', { gameId, turn:1, phase:'choosing' })).advanced, true);
  const resolved = await read(a.db, `games/${gameId}`);
  assert.equal(resolved.phase, 'reveal');
  assert.equal(resolved.resolvedTurn, 1);
  assert.equal(resolved.lastResult.actions[players[3].uid].action, 'distracted');
  assert.equal(resolved.lastResult.actions[players[0].uid].action, 'air');
  assert.equal(resolved.lastResult.actions[players[1].uid].action, 'hide');
  assert.equal((await getDocs(collection(a.db, `games/${gameId}/rounds`))).size, 1);
  await expire(gameId, resolved.rules.revealMs);
  assert.equal((await a.client.call('advanceGame', { gameId, turn:1, phase:'reveal' })).advanced, true);
  const next = await read(a.db, `games/${gameId}`);
  assert.equal(next.phase, 'choosing');
  assert.equal(next.turn, 2);
});


test('relevo de host en locked conserva todas las jugadas y resuelve una sola vez', async () => {
  const { a, b, players, gameId, roomId } = await started(3);
  await choose(players[0], gameId, 1, 'air');
  await choose(players[1], gameId, 1, 'hide');
  await choose(players[2], gameId, 1, 'air');
  await patch(`games/${gameId}`, { phase:'locked', lastProgressAt:Timestamp.now() });
  await patch(`rooms/${roomId}`, { [`members.${a.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-10000) });

  await b.client.call('roomCommand', { command:'touch', roomId });
  const room = await read(b.db, `rooms/${roomId}`);
  assert.equal(room.hostId, b.uid);
  assert.equal(room.status, 'playing');

  const race = await Promise.allSettled([
    a.client.call('advanceGame', { gameId, turn:1, phase:'locked' }),
    b.client.call('advanceGame', { gameId, turn:1, phase:'locked' }),
    b.client.call('advanceGame', { gameId, turn:1, phase:'locked' }),
  ]);
  assert.equal(race[0].status, 'rejected');
  const winners = race.slice(1).filter(result => result.status === 'fulfilled' && result.value.advanced);
  assert.equal(winners.length, 1);

  const game = await read(b.db, `games/${gameId}`);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.resolvedTurn, 1);
  assert.equal(game.lastResult.actions[players[0].uid].action, 'air');
  assert.equal(game.lastResult.actions[players[1].uid].action, 'hide');
  assert.equal(game.lastResult.actions[players[2].uid].action, 'air');
  assert.equal((await getDocs(collection(b.db, `games/${gameId}/rounds`))).size, 1);
});


test('mechón, ataque y límite de Esconderse conviven sin estados imposibles', async () => {
  const { a, players, gameId } = await started(4);
  await patch(`games/${gameId}`, {
    centerItem:{ kind:HAIR_ITEM_KIND, spawnedTurn:1, source:'test' },
    [`players.${players[0].uid}.hair`]:1,
    [`players.${players[1].uid}.breath`]:1,
    [`players.${players[2].uid}.hideStreak`]:2,
  });
  await choose(players[0], gameId, 1, 'grab', CENTER_ITEM_TARGET);
  await choose(players[1], gameId, 1, 'blow', players[0].uid);
  await choose(players[2], gameId, 1, 'hide');
  await choose(players[3], gameId, 1, 'air');
  assert.equal((await a.client.call('advanceGame', { gameId, turn:1, phase:'choosing' })).advanced, true);

  const resolved = await read(a.db, `games/${gameId}`);
  assert.equal(resolved.phase, 'reveal');
  assert.equal(resolved.players[players[0].uid].hair, 0);
  assert.equal(resolved.players[players[1].uid].breath, 0);
  assert.equal(resolved.players[players[2].uid].hideStreak, 3);
  assert.equal(resolved.players[players[3].uid].breath, 1);
  assert.equal(resolved.centerItem, null);
  assert.equal(resolved.lastResult.item.outcome, 'claimed');
  assert.equal(resolved.lastResult.item.claimantAlive, false);
  assert.equal(resolved.lastResult.heals[players[0].uid], undefined);

  await expire(gameId, resolved.rules.revealMs);
  await a.client.call('advanceGame', { gameId, turn:1, phase:'reveal' });
  await assert.rejects(choose(players[2], gameId, 2, 'hide'));
  await choose(players[2], gameId, 2, 'air');
  const nextIntent = await read(players[2].db, `games/${gameId}/intents/${players[2].uid}`);
  assert.equal(nextIntent.turn, 2);
  assert.equal(nextIntent.action, 'air');
});


test('la revancha arranca sin residuos de la partida anterior', async () => {
  const { a, b, players, gameId, roomId } = await started();
  await patch(`games/${gameId}`, {
    phase:'finished',
    finishedAt:Date.now()-1000,
    winnerId:a.uid,
    resolvedTurn:4,
    turn:4,
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:4,source:'test'},
    lastResult:{turn:4,actions:{},hits:[],losses:{},heals:{},item:null},
    [`players.${a.uid}.hair`]:1,
    [`players.${a.uid}.breath`]:2,
    [`players.${a.uid}.hideStreak`]:3,
    [`players.${b.uid}.hair`]:2,
    [`chosen.${a.uid}`]:true,
  });
  await patch(`rooms/${roomId}`, { status:'finished' });

  await a.client.call('roomCommand', { command:'lobby', roomId });
  const lobby = await read(a.db, `rooms/${roomId}`);
  assert.equal(lobby.status, 'lobby');
  assert.equal(lobby.gameId, null);
  assert.ok(Object.values(lobby.members).every(member => member.ready === false));

  for (const player of players) await player.client.call('roomCommand', { command:'ready', roomId, ready:true });
  await a.client.call('roomCommand', { command:'start', roomId });
  const restartedRoom = await read(a.db, `rooms/${roomId}`);
  assert.notEqual(restartedRoom.gameId, gameId);
  const next = await read(a.db, `games/${restartedRoom.gameId}`);
  assert.equal(next.turn, 1);
  assert.equal(next.resolvedTurn, 0);
  assert.equal(next.centerItem, null);
  assert.equal(next.lastResult, null);
  assert.deepEqual(next.chosen, {});
  assert.deepEqual(next.ready, {});
  for (const player of Object.values(next.players)) {
    assert.equal(player.hair, next.rules.initialHair);
    assert.equal(player.breath, next.rules.initialBreath);
    assert.equal(player.hideStreak, 0);
  }
});


test('si el host cae al terminar, el relevo puede devolver la sala al lobby', async () => {
  const { a, b, players, gameId, roomId } = await started(3);
  await patch(`games/${gameId}`, {
    phase:'finished',
    finishedAt:Date.now()-9000,
    lastProgressAt:Timestamp.now(),
    winnerId:a.uid,
  });
  await patch(`rooms/${roomId}`, {
    status:'finished',
    [`members.${a.uid}.lastSeenAt`]:Timestamp.fromMillis(Date.now()-10000),
  });
  await b.client.call('roomCommand', { command:'touch', roomId });
  assert.equal((await read(b.db, `rooms/${roomId}`)).hostId, b.uid);
  await b.client.call('roomCommand', { command:'lobby', roomId });
  const lobby = await read(b.db, `rooms/${roomId}`);
  assert.equal(lobby.status, 'lobby');
  assert.equal(lobby.gameId, null);
  assert.ok(lobby.members[b.uid]);
  assert.ok(lobby.members[players[2].uid]);
  assert.ok(Object.values(lobby.members).every(member => member.ready === false));
});
