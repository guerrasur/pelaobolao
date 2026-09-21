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
  await a.getByLabel('Código de sala').fill(code);
  await a.getByRole('button', { name: 'Unirse a sala' }).click();
  const selfLobby = a.locator('.lobby-list li:has(.lobby-self-tag)');
  await expect(selfLobby.locator('.lobby-player-name')).toHaveText('Ana');
  await expect(selfLobby.locator('.lobby-self-tag')).toHaveText('VOS');
  const lobbyOrder = async page => page.locator('.lobby-player-name').allTextContents();
  const orderBeforeReady = await lobbyOrder(a);
  await a.getByRole('button', { name: 'Estoy listo' }).click();
  await expect.poll(() => lobbyOrder(a)).toEqual(orderBeforeReady);
  await b.getByRole('button', { name: 'Estoy listo' }).click();
  await expect.poll(() => lobbyOrder(a)).toEqual(orderBeforeReady);
  await expect(a.getByRole('button', { name: 'Iniciar partida' })).toBeEnabled();
  await a.getByRole('button', { name: 'Iniciar partida' }).click();
  const turn = async n => {
    for (const page of [a, b]) {
      await expect(page.getByRole('heading', { name: `Turno ${n}`, exact: true })).toBeVisible({ timeout: 25000 });
      await expect(page.locator('.game')).toHaveAttribute('data-phase', 'choosing', { timeout: 20000 });
    }
  };
  const savedOrRevealed = page => expect.poll(() => page.evaluate(() =>
    /(Elegido:|OBJETIVO FIJADO:)/.test(document.querySelector('#selection')?.textContent ?? '')
      || ['locked','reveal','finished'].includes(document.querySelector('.game')?.dataset.phase)
  )).toBe(true);
  const choose = async (page, action) => {
    await page.getByRole('button', { name: action }).click();
    await savedOrRevealed(page);
  };
  const blow = async (page, target) => {
    await page.locator('#blow').click();
    await page.locator('[data-player]').filter({ hasText: target }).click();
    await savedOrRevealed(page);
  };
  await turn(1);
  await a.locator('.brand').click();
  await expect(a.locator('.game')).toBeVisible();
  await expect(a.locator('#notice')).toContainText('Salí de la sala para volver al inicio.');
  await choose(a, /Tomar aire/);
  await expect(a.locator('#notice')).toBeEmpty();
  // Choices of the other player never appear before resolution.
  await expect(a.locator('.result')).toHaveCount(0);
  await choose(b, /Tomar aire/);
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
  await expect(a.locator('#blow-drag-ghost')).toBeVisible();
  await expect(a.locator('#blow-drag-ghost')).toContainText('Beto');
  await expect(a.locator('[data-player]').filter({ hasText: 'Beto' })).toHaveClass(/drag-target/);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await savedOrRevealed(a);
  await a.screenshot({ path: 'test-results/mobile-game.png', fullPage: true });
  await expect(a.locator('.result')).toContainText('bloqueado', { timeout: 12000 });
  await turn(3);
  await choose(a, /Tomar aire/); await blow(b, 'Ana');
  await turn(4);
  await blow(a, 'Beto');
  await expect(a.locator('.condor-aim-guide')).toBeVisible();
  await expect(a.locator('[data-player]').filter({ hasText: 'Beto' })).toHaveClass(/selected-target/);
  await choose(b, /Tomar aire/);
  await turn(5);
  await choose(a, /Tomar aire/); await choose(b, /Esconderse/);
  await contextB.setOffline(true);
  await expect(b.locator('#connection')).toContainText('Sin conexión');
  await contextB.setOffline(false);
  await b.reload();
  await expect(b.getByLabel('Nombre', { exact: true })).toHaveValue('Beto');
  await b.getByRole('button', { name: 'Continuar' }).click();
  await b.getByLabel('Código de sala').fill(code);
  await b.getByRole('button', { name: 'Unirse a sala' }).click();
  await expect(b.locator('[data-player].self .player-label')).toHaveText('Beto');
  await expect(b.locator('[data-player].self .self-tag')).toHaveText('VOS');
  await turn(6);
  await blow(a, 'Beto');
  await turn(7);
  await choose(a, /Tomar aire/); await choose(b, /Esconderse/);
  await turn(8);
  await blow(a, 'Beto');
  await expect(a.getByRole('heading', { name: 'Fin de la partida' })).toBeVisible({ timeout: 18000 });
  await expect(b.getByRole('heading', { name: 'Fin de la partida' })).toBeVisible({ timeout: 18000 });
  await expect(a.locator('.end-celebration[data-outcome="win"]')).toBeVisible();
  await expect(a.locator('.outcome-card')).toContainText('¡GANASTE!');
  await expect(a.locator('.confetti i')).toHaveCount(36);
  await expect(b.locator('.end-celebration[data-outcome="lose"]')).toBeVisible();
  await expect(b.locator('.outcome-card')).toContainText('PERDISTE');
  await expect(b.locator('.outcome-winner')).toContainText('Ganó Ana');
  await expect(b.locator('.tomato')).toHaveCount(6);
  for (const page of [a, b]) {
    await expect(page.locator('[data-player]').filter({ hasText: 'Beto' })).toContainText('Pelado');
  }
  await a.screenshot({ path: 'test-results/winner-celebration.png', fullPage: true });
  await b.screenshot({ path: 'test-results/loser-tomatoes.png', fullPage: true });
  await a.getByRole('button', { name: 'Volver al lobby / revancha' }).click();
  await expect(b.getByRole('heading', { name: 'Jugadores · 2/6' })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Iniciar partida' })).toBeDisabled();
  for (const page of [a, b]) await page.getByRole('button', { name: 'Estoy listo' }).click();
  await expect(a.getByRole('button', { name: 'Iniciar partida' })).toBeEnabled();
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


test('una versión pública anterior no bloquea un cliente más nuevo', async ({ page }) => {
  await page.route('**/version.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: '0.1.0' }),
  }));
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByRole('heading', { name: 'Hay que actualizar para seguir' })).toHaveCount(0);
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
});
