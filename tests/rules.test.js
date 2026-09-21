import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { createClient } from '../src/client.js';
let env, roomId, gameId, a, b, outsider;
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-pelaobolao',firestore:{rules:await readFile('firestore.rules','utf8')}});
  a=env.authenticatedContext('alice').firestore();b=env.authenticatedContext('bob').firestore();outsider=env.authenticatedContext('outsider').firestore();
  for(const [db,uid] of [[a,'alice'],[b,'bob']]) await createClient(db,uid).call('saveProfile',{name:uid});
  ({roomId}=await createClient(a,'alice').call('roomCommand',{command:'create'}));
  await createClient(b,'bob').call('roomCommand',{command:'join',code:roomId});
  await createClient(a,'alice').call('roomCommand',{command:'ready',roomId,ready:true});
  await createClient(b,'bob').call('roomCommand',{command:'ready',roomId,ready:true});
  await createClient(a,'alice').call('roomCommand',{command:'start',roomId});
  gameId=(await getDoc(doc(a,'rooms',roomId))).data().gameId;
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    // Retain coverage for in-progress games created by versions before 0.4.
    await updateDoc(doc(db,'games',gameId),{protocolVersion:1,phase:'choosing',countdownEndsAt:null,deadline:Date.now()+600000});
    for(const uid of ['alice','bob']) await setDoc(doc(db,'games',gameId,'intents',uid),{action:'hide',target:null,turn:1,revision:1,requestId:'seed',submittedAt:Timestamp.now()});
  });
});
after(async()=>env.cleanup());
test('perfil y sesión solo propios; progreso reservado',async()=>{
  await assertSucceeds(getDoc(doc(a,'profiles/alice')));
  await assertFails(getDoc(doc(b,'profiles/alice')));
  await assertFails(updateDoc(doc(b,'profiles/alice'),{name:'intruso',updatedAt:serverTimestamp()}));
  await assertSucceeds(createClient(a,'alice').call('saveProfile',{name:'Ana'}));
  await assertFails(updateDoc(doc(a,'profiles/alice'),{hair:99}));
  await assertFails(setDoc(doc(a,'progress/alice'),{wins:99}));
  await assertFails(getDoc(doc(b,'sessions/alice')));
});
test('ni host ni otro jugador ven decisiones ajenas durante el turno',async()=>{
  await assertSucceeds(getDoc(doc(a,'games',gameId,'intents','alice')));
  await assertFails(getDoc(doc(a,'games',gameId,'intents','bob')));
  await assertFails(getDoc(doc(b,'games',gameId,'intents','alice')));
  await assertFails(getDocs(collection(a,'games',gameId,'intents')));
});
test('propietario cambia solo intención propia válida; no estado ni resultados ni autoridad',async()=>{
  const intent={turn:1,action:'air',target:null,requestId:'new',revision:2,submittedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(b,'games',gameId,'intents','bob'),intent));
  await assertFails(setDoc(doc(b,'games',gameId,'intents','alice'),intent));
  for(const fields of [{action:'blow',target:'alice'},{turn:2},{target:'alice'},{hair:99}])
    await assertFails(setDoc(doc(b,'games',gameId,'intents','bob'),{...intent,revision:3,...fields}));
  await assertFails(updateDoc(doc(b,'games',gameId),{'players.alice.hair':0}));
  await assertFails(setDoc(doc(b,'games',gameId,'rounds','1'),{turn:1}));
  await assertFails(updateDoc(doc(b,'rooms',roomId),{hostId:'bob',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(b,'rooms',roomId),{'members.alice.left':true,updatedAt:serverTimestamp()}));
});
test('ajenos no acceden a la partida; el código exacto permite descubrir una sala activa sin enumerarla',async()=>{
  const anonymous=env.unauthenticatedContext().firestore();
  for(const db of [outsider,anonymous]) {
    for(const path of [`games/${gameId}`,`games/${gameId}/intents/alice`,`games/${gameId}/rounds/1`])
      await assertFails(getDoc(doc(db,path)));
  }
  await assertSucceeds(getDoc(doc(outsider,`rooms/${roomId}`)));
  await assertFails(getDoc(doc(anonymous,`rooms/${roomId}`)));
  await assertFails(getDocs(collection(a,'rooms')));
});
test('después del cierre host lee; intenciones tardías, resolución prematura y reescritura bloqueadas',async()=>{
  await assertFails(updateDoc(doc(a,'games',gameId),{resolvedTurn:1,phase:'reveal'}));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'games',gameId),{deadline:Date.now()-5000}));
  await assertSucceeds(getDoc(doc(a,'games',gameId,'intents','bob')));
  await assertFails(getDoc(doc(outsider,'games',gameId,'intents','bob')));
  await assertFails(getDoc(doc(b,'games',gameId,'intents','alice')));
  await assertFails(setDoc(doc(b,'games',gameId,'intents','bob'),{turn:1,action:'air',target:null,requestId:'late',revision:3,submittedAt:serverTimestamp()}));
  await createClient(a,'alice').call('advanceGame',{gameId,turn:1,phase:'choosing'});
  await assertSucceeds(getDoc(doc(b,'games',gameId,'rounds','1')));
  await assertFails(updateDoc(doc(a,'games',gameId,'rounds','1'),{turn:999}));
  await assertFails(deleteDoc(doc(a,'games',gameId,'rounds','1')));
  await assertFails(updateDoc(doc(a,'games',gameId),{'players.bob.hair':0}));
});
