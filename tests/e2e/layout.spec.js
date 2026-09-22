import { test, expect } from '@playwright/test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { newGame, resolveRound } from '../../src/game.js';

let env;
test.beforeAll(async () => { env = await initializeTestEnvironment({ projectId:'demo-pelaobolao', firestore:{host:'127.0.0.1',port:8080} }); });
test.afterAll(async () => { await env.cleanup(); });

test('el tablero y sus controles caben completos con 2 y 6 jugadores', async ({page}) => {
  await page.goto('/');
  await page.locator('#player-name').fill('Nombre de veinticuatro');
  await page.locator('#profile-form button').click();
  await page.locator('#create-room').click();
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


test('el lobby mantiene SALA neutro y resalta sólo el código amarillo en mobile angosto', async ({ page }) => {
  await page.setViewportSize({ width:320, height:568 });
  await page.goto('/');
  await page.locator('#player-name').fill('Lobby');
  await page.locator('#profile-form button').click();
  await page.locator('#create-room').click();

  await expect(page.locator('.lobby-room-label')).toHaveText('SALA');
  await expect(page.locator('.lobby-heading .code')).toHaveText(/^[A-Z2-9]{4}$/);

  const layout = await page.evaluate(() => {
    const heading = document.querySelector('.lobby-heading').getBoundingClientRect();
    const label = document.querySelector('.lobby-room-label');
    const code = document.querySelector('.lobby-heading .code');
    const share = document.querySelector('#share-room').getBoundingClientRect();
    const codeRect = code.getBoundingClientRect();
    return {
      headingRight: heading.right,
      codeRight: codeRect.right,
      shareRight: share.right,
      viewport: innerWidth,
      bodyScrollWidth: document.documentElement.scrollWidth,
      codeBackground: getComputedStyle(code).backgroundColor,
      labelBackground: getComputedStyle(label).backgroundColor,
      codeBorderStyle: getComputedStyle(code).borderTopStyle,
    };
  });

  expect(layout.codeBackground).toBe('rgb(255, 223, 79)');
  expect(layout.labelBackground).not.toBe('rgb(255, 223, 79)');
  expect(layout.codeBorderStyle).toBe('dashed');
  expect(layout.headingRight).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.codeRight).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.shareRight).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
});
