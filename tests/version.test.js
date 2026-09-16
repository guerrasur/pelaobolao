import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoomCode, ROOM_CODE_PATTERN } from '../src/client.js';

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
