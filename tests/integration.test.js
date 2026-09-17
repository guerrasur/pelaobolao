import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, updateDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { createClient } from '../src/client.js';
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
test('creación idempotente, inicio único ante concurrencia y solo host inicia',async()=>{
  const {a,b,roomId}=await pair();
  const duplicates=await Promise.all([a.client.call('roomCommand',{command:'create'}),a.client.call('roomCommand',{command:'create'})]);
  assert.ok(duplicates.every(r=>r.roomId===roomId));
  await assert.rejects(b.client.call('roomCommand',{command:'start',roomId}));
  await a.client.call('roomCommand',{command:'ready',roomId,ready:true});
  await b.client.call('roomCommand',{command:'ready',roomId,ready:true});
  const starts=await Promise.allSettled([a.client.call('roomCommand',{command:'start',roomId}),a.client.call('roomCommand',{command:'start',roomId})]);
  assert.ok(starts.some(result=>result.status==='fulfilled'));
  await seed(async db => assert.equal((await getDocs(collection(db,'games'))).docs.filter(d=>d.data().roomId===roomId).length,1));
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
  await a.client.call('roomCommand',{command:'start',roomId});
  assert.notEqual((await read(a.db,`rooms/${roomId}`)).gameId,gameId);
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

test('celular lento: el siguiente reloj no arranca hasta recibir ambas confirmaciones', async () => {
  const {a,b,gameId}=await started();
  await advance(a,gameId,{acknowledge:false});
  await expire(gameId,2500);
  await a.client.call('advanceGame',{gameId,turn:1,phase:'reveal'});
  await a.client.call('acknowledgeRound',{gameId,turn:2});
  assert.equal((await a.client.call('advanceGame',{gameId,turn:2,phase:'syncing'})).advanced,false);
  await assert.rejects(choose(a,gameId,2,'air'));
  await b.client.call('acknowledgeRound',{gameId,turn:1}); // old tab cannot ACK a new round
  assert.equal((await read(a.db,`games/${gameId}`)).ready[b.uid],undefined);
  await b.client.call('acknowledgeRound',{gameId,turn:2});
  assert.equal((await a.client.call('advanceGame',{gameId,turn:2,phase:'syncing'})).advanced,true);
  const g=await read(a.db,`games/${gameId}`);
  assert.equal(g.phase,'choosing');assert.ok(Date.now()-g.phaseStartedAt.toMillis()<2000);
  assert.deepEqual(g.chosen,{});
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
  await updateDoc(doc(a.db,`games/${gameId}`),{phase:'locked'});
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
