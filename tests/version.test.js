import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoomCode, ROOM_CODE_PATTERN } from '../src/client.js';
import { compareVersions, isNewerVersion } from '../src/version.js';

test('la versión pública coincide con package.json', async () => {
  const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
  const publicVersion = JSON.parse(await readFile('public/version.json', 'utf8'));
  assert.equal(publicVersion.version, packageInfo.version);
});

test('los códigos compartibles tienen exactamente 4 caracteres válidos', () => {
  for (let index = 0; index < 500; index += 1) {
    assert.match(createRoomCode(), ROOM_CODE_PATTERN);
  }
});


test('el bloqueo de actualización sólo acepta versiones realmente más nuevas', () => {
  assert.equal(compareVersions('0.7.0','0.6.9'),1);
  assert.equal(compareVersions('0.6.9','0.7.0'),-1);
  assert.equal(compareVersions('0.6.9','0.6.9'),0);
  assert.equal(compareVersions('1.0','1.0.0'),0);
  assert.equal(isNewerVersion('0.7.0','0.6.9'),true);
  assert.equal(isNewerVersion('0.6.8','0.6.9'),false);
  assert.equal(isNewerVersion('versión-vieja','0.6.9'),false);
});


test('0.21 se instala como app móvil y mantiene fresco el gate de versión', async () => {
  const html = await readFile('index.html', 'utf8');
  const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  const worker = await readFile('public/sw.js', 'utf8');
  const encodedIcon = (await readFile('assets/pwa/icon-192.b64', 'utf8')).trim();

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.src === '/icon-192.png'));
  assert.ok(manifest.icons.some(icon => icon.sizes === 'any' && icon.src === '/icon.svg'));
  assert.match(worker, /pelaobolao-shell-0\.21\.0/);
  assert.match(worker, /skipWaiting/);
  assert.match(worker, /url\.pathname === '\/version\.json'/);
  const icon = Buffer.from(encodedIcon, 'base64');
  assert.ok(icon.length > 1000);
  assert.deepEqual([...icon.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});


test('0.21 mantiene el targeting limpio y recalibra la guía en viewport móvil', async () => {
  const [html, visuals, legacyCss, condor20Css, condor20Js] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('src/visuals.js', 'utf8'),
    readFile('src/condor.css', 'utf8'),
    readFile('src/condor20.css', 'utf8'),
    readFile('src/condor20.js', 'utf8'),
  ]);
  assert.doesNotMatch(visuals, /attack-target-badge/);
  assert.match(legacyCss, /\.player\.drag-target::after,[\s\S]*?content:none!important;[\s\S]*?display:none!important;/);
  assert.match(condor20Css, /\.condor-aim-guide::before,[\s\S]*?#blow-drag-vector::before[\s\S]*?content:none!important;[\s\S]*?display:none!important;/);
  assert.match(html, /src="\/src\/condor20\.js"/);
  assert.match(condor20Js, /visualViewport\?\.addEventListener\('resize'/);
  assert.match(condor20Js, /visualViewport\?\.addEventListener\('scroll'/);
  assert.match(condor20Js, /orientationchange/);
  assert.match(condor20Js, /visibilitychange/);
  assert.match(condor20Js, /dispatchEvent\(new Event\('resize'\)\)/);
});
