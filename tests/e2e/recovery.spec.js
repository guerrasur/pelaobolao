import { test, expect } from '@playwright/test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import packageInfo from '../../package.json' with { type: 'json' };

let env;
test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-pelaobolao', firestore: { host: '127.0.0.1', port: 8080 } });
});
test.afterAll(async () => { await env?.cleanup(); });
const admin = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const read = path => admin(async db => (await getDoc(doc(db, path))).data());
const patch = (path, data) => admin(db => updateDoc(doc(db, path), data));

async function pair(browser, host) {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  for (const [page, name] of [[host, 'Ana'], [guest, '<b>Beto</b>']]) {
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Nombre', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('button', { name: 'Crear sala' })).toBeVisible();
  }
  await host.getByRole('button', { name: 'Crear sala' }).click();
  const code = await host.locator('.code').textContent();
  await guest.getByLabel('Código de sala').fill(code);
  await guest.getByRole('button', { name: 'Unirse a sala' }).click();
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Estoy listo' }).click();
  await host.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(host.getByRole('heading', { name: 'Turno 1', exact: true })).toBeVisible();
  const room = await read(`rooms/${code}`);
  return { guestContext, guest, code, room, gameId: room.gameId };
}

test('reingresar con un turno vencido no rompe la pantalla del nombre', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { guestContext, guest, gameId } = await pair(browser, page);
  try {
    await page.reload();
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Ana');
    await patch(`games/${gameId}`, { deadline: Date.now() - 5000 });
    await expect(guest.getByRole('heading', { name: 'Resultado actual' })).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.locator('.players')).toContainText('Ana (vos)');
    expect(errors).toEqual([]);
  } finally { await guestContext.close(); }
});

test('actualización cancela arrastre, bloquea acciones y recupera sala al recargar', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { guestContext, code, room, gameId } = await pair(browser, page);
  try {
    await patch(`games/${gameId}`, { [`players.${room.hostId}.breath`]: 1, deadline: Date.now() + 60000 });
    await expect(page.locator('#blow')).toBeEnabled();
    await page.locator('#blow').click();
    await page.locator('[data-player]').filter({ hasText: '<b>Beto</b>' }).click();
    await expect(page.locator('#selection')).toContainText('Elegido: Soplar → <b>Beto</b>');
    await expect(page.locator('#selection b')).toHaveCount(0);
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
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Ana');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.locator('.game .eyebrow')).toHaveText(`Sala ${code}`);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/recovered-mobile.png', fullPage: true });
  } finally { await guestContext.close(); }
});

test('una partida desaparecida tiene salida y permite crear otra sala', async ({ browser, page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const { guestContext, gameId, code } = await pair(browser, page);
  try {
    await admin(db => deleteDoc(doc(db, 'games', gameId)));
    await expect(page.getByRole('button', { name: 'Volver al inicio' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver al inicio' }).click();
    await page.getByRole('button', { name: 'Crear sala' }).click();
    await expect(page.locator('.code')).toBeVisible();
    await expect(page.locator('.code')).not.toHaveText(code);
    expect(errors).toEqual([]);
  } finally { await guestContext.close(); }
});
