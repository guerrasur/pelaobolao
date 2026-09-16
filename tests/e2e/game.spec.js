import { test, expect } from '@playwright/test';

test('dos celulares: identidad, lobby, drag, tap, reconexión, partida completa y revancha', async ({ browser, page: a }) => {
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const b = await contextB.newPage();
  const errors = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  for (const [page, name] of [[a, 'Ana'], [b, 'Beto']]) {
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Nombre', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('button', { name: 'Crear sala' })).toBeVisible();
  }
  await a.getByRole('button', { name: 'Crear sala' }).click();
  const code = await a.locator('.code').textContent();
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
  await expect(a.getByRole('button', { name: 'Iniciar partida' })).toBeDisabled();
  await b.goto(`http://127.0.0.1:5173/?s=${code}`);
  await expect(b.getByLabel('Nombre', { exact: true })).toHaveValue('Beto');
  await b.getByRole('button', { name: 'Continuar' }).click();
  await expect(b.getByLabel('Código de sala')).toHaveValue(code);
  await b.getByRole('button', { name: 'Unirse a sala' }).click();
  await expect(a.getByRole('heading', { name: 'Jugadores · 2/6' })).toBeVisible();
  await a.reload();
  await expect(a.getByLabel('Nombre', { exact: true })).toHaveValue('Ana');
  await a.getByRole('button', { name: 'Continuar' }).click();
  await expect(a.locator('.lobby-list')).toContainText('Ana (vos)');
  for (const page of [a, b]) await page.getByRole('button', { name: 'Estoy listo' }).click();
  await expect(a.getByRole('button', { name: 'Iniciar partida' })).toBeEnabled();
  await a.getByRole('button', { name: 'Iniciar partida' }).click();
  const turn = async n => {
    for (const page of [a, b]) await expect(page.getByRole('heading', { name: `Turno ${n}`, exact: true })).toBeVisible({ timeout: 18000 });
  };
  const choose = async (page, action) => {
    await page.getByRole('button', { name: action }).click();
    await expect(page.locator('#selection')).toContainText('Elegido:', { timeout: 6000 });
  };
  const blow = async (page, target) => {
    await page.locator('#blow').click();
    await page.locator('[data-player]').filter({ hasText: target }).click();
    await expect(page.locator('#selection')).toContainText(`Elegido: Soplar → ${target}`, { timeout: 6000 });
  };
  await turn(1);
  await choose(a, /Tomar aire/); await choose(b, /Tomar aire/);
  // Choices of the other player never appear before resolution.
  await expect(a.locator('.result')).toHaveCount(0);
  await turn(2);
  await choose(b, /Esconderse/);
  const source = await a.locator('#blow').boundingBox();
  const target = await a.locator('[data-player]').filter({ hasText: 'Beto' }).boundingBox();
  const touch = await a.context().newCDPSession(a);
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 12; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: from.x + (to.x - from.x) * step / 12,
      y: from.y + (to.y - from.y) * step / 12,
    }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await expect(a.locator('#selection')).toContainText('Elegido: Soplar → Beto');
  await a.screenshot({ path: 'test-results/mobile-game.png', fullPage: true });
  await turn(3);
  await expect(a.locator('.result')).toContainText('bloqueado');
  await choose(a, /Tomar aire/); await blow(b, 'Ana');
  await turn(4);
  await blow(a, 'Beto'); await choose(b, /Tomar aire/);
  await turn(5);
  await choose(a, /Tomar aire/); await choose(b, /Esconderse/);
  await contextB.setOffline(true);
  await expect(b.locator('#connection')).toContainText('Sin conexión');
  await contextB.setOffline(false);
  await b.reload();
  await expect(b.getByLabel('Nombre', { exact: true })).toHaveValue('Beto');
  await b.getByRole('button', { name: 'Continuar' }).click();
  await expect(b.locator('.players')).toContainText('Beto (vos)');
  await turn(6);
  await blow(a, 'Beto');
  await turn(7);
  await choose(a, /Tomar aire/); await choose(b, /Esconderse/);
  await turn(8);
  await blow(a, 'Beto');
  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'Ganó Ana' })).toBeVisible({ timeout: 18000 });
    await expect(page.locator('[data-player]').filter({ hasText: 'Beto' })).toContainText('Pelado');
  }
  await a.getByRole('button', { name: 'Volver al lobby / revancha' }).click();
  await expect(b.getByRole('heading', { name: 'Jugadores · 2/6' })).toBeVisible();
  await a.getByRole('button', { name: 'Iniciar partida' }).click();
  await turn(1);
  await expect(a.locator('[data-player]').filter({ hasText: 'Ana' })).toContainText('Pelo 3/4');
  expect(errors).toEqual([]);
  await contextB.close();
});

test('una versión nueva bloquea el juego hasta actualizar', async ({ page }) => {
  await page.route('**/version.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: '99.0.0' }),
  }));
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByRole('heading', { name: 'Hay que actualizar para seguir' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar ahora' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear sala' })).toHaveCount(0);
});
