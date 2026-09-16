import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, updateDoc, Timestamp } from 'firebase/firestore';
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
  await patch(`games/${gameId}`,{countdownEndsAt:Date.now()-5000});
  await p.a.client.call('advanceGame',{gameId,turn:1,phase:'countdown'});
  return {...p,gameId};
}
const choose = (p,gameId,turn,action,target=null,revision=0,requestId=crypto.randomUUID()) =>
  p.client.call('submitIntent',{gameId,turn,action,target,expectedRevision:revision,requestId});
async function advance(p, gameId) {
  const g=await read(p.db,`games/${gameId}`);
  await patch(`games/${gameId}`,{[g.phase==='choosing'?'deadline':'nextTurnAt']:Date.now()-5000});
  return p.client.call('advanceGame',{gameId,turn:g.turn,phase:g.phase});
}
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
  await patch(`games/${gameId}`,{deadline:Date.now()-5000});
  await assert.rejects(choose(a,gameId,1,'air',null,2));
});
test('seis jugadores, resoluciones concurrentes y repetidas no duplican daño ni resultados',async()=>{
  const {a,b,players,gameId}=await started(6);
  await patch(`games/${gameId}`,Object.fromEntries(players.map(p=>[`players.${p.uid}.breath`,1])));
  for(const p of players) await choose(p,gameId,1,'blow',p===b?a.uid:b.uid);
  await patch(`games/${gameId}`,{deadline:Date.now()-5000});
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
  await patch(`games/${gameId}`,{deadline:Date.now()-5000});
  await assert.rejects(a.client.call('advanceGame',{gameId,turn:1,phase:'choosing'}));
  await host.client.call('advanceGame',{gameId,turn:1,phase:'choosing'});
  assert.equal((await read(host.db,`games/${gameId}`)).players[a.uid].breath,1);
  await a.client.call('roomCommand',{command:'touch',roomId});
  assert.equal((await read(b.db,`rooms/${roomId}`)).hostId,host.uid);
});
test('salida explícita del host en partida mantiene recursos y transfiere',async()=>{
  const {a,b,gameId,roomId}=await started();
  await a.client.call('roomCommand',{command:'leave',roomId});
  assert.equal((await read(b.db,`rooms/${roomId}`)).hostId,b.uid);
  await advance(b,gameId);
  assert.equal((await read(b.db,`games/${gameId}`)).players[a.uid].hair,3);
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
