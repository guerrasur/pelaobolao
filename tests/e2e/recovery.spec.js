import { test, expect } from '@playwright/test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import packageInfo from '../../package.json' with { type: 'json' };

let env;
test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-pelaobolao', firestore: { host: '127.0.0.1', port: 8080 } });
});
test.afterAll(async () => { await env?.cleanup(); });
const admin = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const read = async path => {
  let value;
  await admin(async db => { value = (await getDoc(doc(db, path))).data(); });
  return value;
};
const patch = (path, data) => admin(db => updateDoc(doc(db, path), data));

async function pair(browser, host) {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  for (const [page, name] of [[host, 'Ana'], [guest, '<b>Beto</b>']]) {
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Nombre del jugador', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Entrar al aula' }).click();
    await expect(page.locator('#create-room')).toBeVisible();
  }
  await host.locator('#create-room').click();
  const code = await host.locator('.code').textContent();
  await guest.getByLabel('Código de sala').fill(code);
  await guest.getByRole('button', { name: 'ENTRAR', exact: true }).click();
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Estoy listo' }).click();
  await host.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(host.getByRole('heading', { name: 'Turno 1', exact: true })).toBeVisible();
  await expect(host.locator('.game')).toHaveAttribute('data-phase','choosing');
  const room = await read(`rooms/${code}`);
  return { guestContext, guest, code, room, gameId: room.gameId };
}

test('reingresar con un turno vencido no rompe la pantalla del nombre', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { guestContext, guest, gameId, code } = await pair(browser, page);
  try {
    await page.reload();
    await expect(page.getByLabel('Nombre del jugador', { exact: true })).toHaveValue('Ana');
    await patch(`games/${gameId}`, { deadline: Date.now() - 5000, phaseStartedAt: Timestamp.fromMillis(Date.now()-15000) });
    // The reloaded host does not resume or advance the saved match on its own.
    await expect(page.getByLabel('Nombre del jugador', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Entrar al aula' }).click();
    await expect(page.locator('#create-room')).toBeVisible();
    await page.getByLabel('Código de sala').fill(code);
    await page.getByRole('button', { name: 'ENTRAR', exact: true }).click();
    await expect(page.locator('[data-player].self .player-label')).toHaveText('Ana');
    await expect(page.locator('[data-player].self .self-tag')).toHaveText('VOS');
    expect(errors).toEqual([]);
  } finally { await guestContext.close(); }
});

test('actualización cancela arrastre, bloquea acciones y permite reingresar con código al recargar', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { guestContext, code, room, gameId } = await pair(browser, page);
  try {
    await patch(`games/${gameId}`, { [`players.${room.hostId}.breath`]: 1, 'rules.turnMs': 60000 });
    await expect(page.locator('#blow')).toBeEnabled();
    await page.locator('#blow').click();
    await page.locator('[data-player]').filter({ hasText: '<b>Beto</b>' }).click();
    await expect(page.locator('#selection')).toContainText('OBJETIVO FIJADO: <b>Beto</b> · SOPLO preparado');
    await expect(page.locator('#selection b')).toHaveCount(0);
    const selectedTarget = page.locator('[data-player]').filter({ hasText: '<b>Beto</b>' });
    await expect(selectedTarget).toHaveClass(/selected-target/);
    await expect(selectedTarget.locator('.attack-target-badge')).toHaveCount(0);
    const intentPath = `games/${gameId}/intents/${room.hostId}`;
    const before = await read(intentPath);
    await page.evaluate(() => { window.oldActionButton = document.querySelector('[data-action="air"]'); });
    const rect = await page.locator('#blow').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    let version = '99.0.0';
    await page.route('**/version.json*', route => route.fulfill({ json: { version } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('button', { name: 'Actualizar ahora' })).toBeVisible();
    await page.mouse.up();
    await page.evaluate(() => window.oldActionButton.click());
    expect((await read(intentPath)).revision).toBe(before.revision);
    await expect(page.locator('.controls')).toHaveCount(0);
    version = packageInfo.version;
    await page.getByRole('button', { name: 'Actualizar ahora' }).click();
    await expect(page.getByLabel('Nombre del jugador', { exact: true })).toHaveValue('Ana');
    await page.getByRole('button', { name: 'Entrar al aula' }).click();
    await expect(page.locator('#create-room')).toBeVisible();
    await page.getByLabel('Código de sala').fill(code);
    await page.getByRole('button', { name: 'ENTRAR', exact: true }).click();
    await expect(page.locator('.game .eyebrow')).toHaveText(`Sala ${code}`);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/recovered-mobile.png', fullPage: true });
  } finally { await guestContext.close(); }
});

test('Plan Condor 0.18: Agarrar no se mezcla con apuntar Soplar y tiene feedback propio', async ({ browser, page }) => {
  const { guestContext, guest, room, gameId } = await pair(browser, page);
  try {
    await patch(`games/${gameId}`, {
      centerItem:{ kind:'hair_plus_1', spawnedTurn:1, source:'test' },
      'rules.turnMs':60000,
      [`players.${room.hostId}.breath`]:1,
    });
    const item = page.locator('[data-center-item]');
    await expect(item).toBeVisible();
    await expect(item).toBeEnabled();

    await page.locator('#blow').click();
    await expect(page.locator('.game')).toHaveAttribute('data-targeting','true');
    await expect(item).toBeDisabled();
    await expect(item).not.toHaveClass(/targetable/);
    await expect(page.locator('.condor-aim-guide')).toHaveCount(0);

    await page.locator('#blow').click();
    await expect(item).toBeEnabled();
    await item.click();
    await expect(page.locator('#selection')).toContainText(/MECHÓN ELEGIDO|Agarrando el mechón/);
    await expect(item).toHaveClass(/selected-grab/);
    await expect(item).not.toHaveClass(/selected-target/);
    await expect(page.locator('.condor-aim-guide')).toHaveCount(0);
    await expect(item).toHaveClass(/condor-grab-confirmed/);

    await expect.poll(async () => (await read(`games/${gameId}/intents/${room.hostId}`))?.action).toBe('grab');
    const intent = await read(`games/${gameId}/intents/${room.hostId}`);
    expect(intent.target).toBe('__center_item__');
    expect((await read(`games/${gameId}`)).players[room.hostId].breath).toBe(1);

    await guest.getByRole('button',{name:'Esconderse',exact:true}).click();
    await expect(page.locator('.result')).toBeVisible({timeout:5000});
    await expect(page.locator('[data-player].self .fx-grab')).toHaveCount(1);
    await expect(page.locator('[data-player].self .fx-label-grab')).toContainText('AGARRA');
  } finally { await guestContext.close(); }
});

test('dos relojes distintos y cierre anticipado mantienen el siguiente turno sincronizado', async ({browser,page}) => {
  // Simulate a device with a clock one hour ahead before calibration.
  await page.addInitScript(() => {
    const realNow=Date.now.bind(Date);Date.now=()=>realNow()+3600000;
  });
  const {guestContext,guest,gameId}=await pair(browser,page);
  try {
    await expect(guest.locator('.game')).toHaveAttribute('data-phase','choosing');
    const seconds=async p=>Number((await p.locator('#timer').textContent()).replace(/\D/g,''));
    expect(Math.abs(await seconds(page)-await seconds(guest))).toBeLessThanOrEqual(1);
    await page.getByRole('button',{name:'Tomar aire',exact:true}).click();
    await expect(page.locator('#selection')).toContainText('Elegido:');
    expect((await read(`games/${gameId}`)).phase).toBe('choosing');
    // A background/suspended tab no longer blocks the following round.
    await guest.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
    await guest.getByRole('button',{name:'Tomar aire',exact:true}).click();
    await expect(page.locator('.result')).toBeVisible({timeout:4000});
    await expect(page.locator('.game')).toHaveAttribute('data-phase','choosing',{timeout:6000});
    await guest.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for(const p of [page,guest]) {
      await expect(p.locator('.game')).toHaveAttribute('data-phase','choosing');
      expect(await seconds(p)).toBeGreaterThanOrEqual(6);
    }
    expect(Math.abs(await seconds(page)-await seconds(guest))).toBeLessThanOrEqual(1);
    await page.screenshot({path:'test-results/classroom-mobile.png',fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally { await guestContext.close(); }
});

test('una partida desaparecida tiene salida y permite crear otra sala', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { guestContext, gameId, code } = await pair(browser, page);
  try {
    await admin(db => deleteDoc(doc(db, 'games', gameId)));
    // A denied subscription resets locally immediately; a missing snapshot offers an exit.
    await expect(page.locator('#create-room').or(page.getByRole('button', { name: 'Volver al inicio' }))).toBeVisible();
    if (await page.getByRole('button', { name: 'Volver al inicio' }).count()) await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await page.locator('#create-room').click();
    await expect(page.locator('.code')).toBeVisible();
    await expect(page.locator('.code')).not.toHaveText(code);
    expect(errors).toEqual([]);
  } finally { await guestContext.close(); }
});


test('host en segundo plano: el otro jugador retoma y ambos siguen al volver', async ({browser,page}) => {
  const {guestContext,guest,gameId,code}=await pair(browser,page);
  try {
    await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
    await expect.poll(async()=>(await read(`rooms/${code}`)).hostId,{timeout:20000}).not.toBe((await read(`rooms/${code}`)).hostId);
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async()=>(await read(`games/${gameId}`)).turn,{timeout:25000}).toBeGreaterThan(1);
    for(const p of [page,guest]) await expect(p.locator('.game')).toBeVisible();
  } finally { await guestContext.close(); }
});


test('cancelar compartir después de salir de la sala no rompe la app', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => new Promise((_, reject) => { window.rejectPendingShare = reject; }),
    });
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByLabel('Nombre del jugador', { exact: true }).fill('Ana');
  await page.getByRole('button', { name: 'Entrar al aula' }).click();
  await page.locator('#create-room').click();
  await page.getByRole('button', { name: 'Compartir' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.rejectPendingShare)).toBe('function');
  await page.getByRole('button', { name: 'Salir de la sala' }).click();
  await page.evaluate(() => window.rejectPendingShare(new Error('cancelled')));
  await expect(page.locator('#create-room')).toBeVisible();
  expect(errors).toEqual([]);
});
