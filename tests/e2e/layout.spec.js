import { test, expect } from '@playwright/test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { newGame, resolveRound } from '../../src/game.js';

let env;
test.beforeAll(async () => { env = await initializeTestEnvironment({ projectId:'demo-pelaobolao', firestore:{host:'127.0.0.1',port:8080} }); });
test.afterAll(async () => { await env.cleanup(); });

test('el tablero y sus controles caben completos con 2 y 6 jugadores', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Nombre',{exact:true}).fill('Nombre de veinticuatro');
  await page.getByRole('button',{name:'Continuar'}).click();
  await page.getByRole('button',{name:'Crear sala'}).click();
  const code=await page.locator('.code').textContent();
  // Freeze only automatic test progression, while retaining real app rendering/listeners.
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
  let room;
  await env.withSecurityRulesDisabled(async ctx=>{room=(await getDoc(doc(ctx.firestore(),'rooms',code))).data();});
  for(const count of [2,6]) {
    const members={...room.members};
    for(let i=1;i<count;i++) members[`layout-${i}`]={name:`Rival largo número ${i}`,joinedAt:Date.now()+i,lastSeenAt:Timestamp.now(),left:false,ready:true};
    const game=newGame(code,members,Date.now());
    game.phase='choosing'; game.phaseStartedAt=Timestamp.now(); game.lastProgressAt=Timestamp.now();
    game.chosen = Object.fromEntries(game.memberIds.map((uid,index)=>[uid,index % 2 === 0]));
    const gameId=`layout-${code}-${count}`;
    await env.withSecurityRulesDisabled(async ctx=>{
      await setDoc(doc(ctx.firestore(),'games',gameId),game);
      await updateDoc(doc(ctx.firestore(),'rooms',code),{status:'playing',gameId,members});
    });
    await expect(page.locator('[data-player]')).toHaveCount(count);
    for(const [width,height] of [[320,568],[390,664],[390,844],[768,1024],[1366,768],[844,390]]) {
      await page.setViewportSize({width,height});
      const brand = await page.evaluate(() => {
        const el = document.querySelector('.brand');
        const rect = el.getBoundingClientRect();
        const tape = getComputedStyle(el, '::before');
        return {
          centerDelta: Math.abs((rect.left + rect.width / 2) - innerWidth / 2),
          top: rect.top,
          bottom: rect.bottom,
          tapeDisplay: tape.display,
          tapeContent: tape.content,
        };
      });
      expect(await page.locator('.brand small').count()).toBe(0);
      await expect(page.locator('.brand')).not.toContainText('MENOS PELO');
      expect(brand.centerDelta, `logo centrado ${width}x${height}`).toBeLessThanOrEqual(2);
      expect(brand.top).toBeGreaterThanOrEqual(0);
      expect(brand.bottom).toBeLessThanOrEqual(height);
      expect(brand.tapeDisplay).not.toBe('none');
      expect(brand.tapeContent).not.toBe('none');
      for(const phase of ['choosing','reveal','finished']) {
        const result=resolveRound(game,{}).result;
        await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'games',gameId),{
          phase,lastResult:result,winnerId:room.hostId,
        }));
        await expect(page.locator('.game')).toHaveAttribute('data-phase',phase);
        const failures=await page.evaluate(()=>{
          const bad=[];
          for(const selector of ['.game','.players','[data-player]','.controls button','.result','.end-celebration','.outcome-card','.outcome-winner','#back-lobby','#leave-room']) {
            for(const el of document.querySelectorAll(selector)) {
              const r=el.getBoundingClientRect();
              if(r.top<0||r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1) bad.push(`${selector}: fuera del viewport`);
              if(el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2) bad.push(`${selector}: contenido recortado`);
            }
          }
          for(const el of document.querySelectorAll('.resources>span:not(.hair-pips):not(.breath-pips)')) {
            const r=el.getBoundingClientRect(), body=el.closest('.player-body').getBoundingClientRect();
            if(r.top<body.top-1 || r.bottom>body.bottom+1) bad.push('recursos fuera de la tarjeta');
          }
          if(document.documentElement.scrollHeight>innerHeight+1) bad.push('scroll de página');
          return bad;
        });
        expect(failures,`${count} jugadores ${width}x${height} ${phase}`).toEqual([]);
      }
      if(count===6 && width===390 && height===664) await page.screenshot({path:'test-results/fullscreen-six-mobile.png'});
    }
  }
});


test('el Mechón flotante aparece sin mover perceptiblemente las tarjetas', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Nombre', {exact:true}).fill('Ana');
  await page.getByRole('button',{name:'Continuar'}).click();
  await page.getByRole('button',{name:'Crear sala'}).click();
  const code=await page.locator('.code').textContent();
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));

  let room;
  await env.withSecurityRulesDisabled(async ctx=>{room=(await getDoc(doc(ctx.firestore(),'rooms',code))).data();});
  const members={...room.members,'layout-item-rival':{name:'Beto',joinedAt:Date.now()+1,lastSeenAt:Timestamp.now(),left:false,ready:true}};
  const game=newGame(code,members,Date.now());
  game.phase='choosing';
  game.turn=4;
  game.phaseStartedAt=Timestamp.now();
  game.lastProgressAt=Timestamp.now();
  game.centerItem=null;
  const gameId=`layout-item-${code}`;
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'games',gameId),game);
    await updateDoc(doc(ctx.firestore(),'rooms',code),{status:'playing',gameId,members});
  });

  await page.setViewportSize({width:390,height:664});
  await expect(page.locator('[data-player]')).toHaveCount(2);
  const before=await page.locator('[data-player]').evaluateAll(els=>els.map(el=>{
    const r=el.getBoundingClientRect();
    return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];
  }));

  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'games',gameId),{
    centerItem:{kind:'hair_plus_1',spawnedTurn:4,source:'test'}
  }));
  await expect(page.locator('[data-center-item]')).toBeVisible();
  await expect(page.locator('.floating-hair-art')).toBeVisible();

  const after=await page.locator('[data-player]').evaluateAll(els=>els.map(el=>{
    const r=el.getBoundingClientRect();
    return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];
  }));
  expect(after.length).toBe(before.length);
  after.forEach((box,index)=>box.forEach((value,axis)=>{
    expect(Math.abs(value-before[index][axis]), `tarjeta ${index + 1}, eje ${axis} se movió demasiado`).toBeLessThanOrEqual(2);
  }));
  await expect(page.locator('.center-item-slot [data-center-item]')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
});
