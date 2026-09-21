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
