import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function worker({ fetch, match = async () => null, open = async () => ({ put: async () => {} }) }) {
  const events = {}, lifetime = [];
  const scope = { self: { location: { origin: 'https://game.test' }, addEventListener: (name, fn) => { events[name] = fn; } },
    URL, Response, fetch, caches: { match, open } };
  vm.runInNewContext(await readFile('public/sw.js', 'utf8'), scope);
  return { lifetime, request(path, mode = 'cors') {
    let response;
    events.fetch({ request: { url: `https://game.test${path}`, method: 'GET', mode },
      respondWith: value => { response = value; }, waitUntil: value => lifetime.push(value) });
    return response;
  } };
}

test('la caché guarda la respuesta incluso si el navegador ya consumió su cuerpo', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let saved;
  const w = await worker({ fetch: async () => new Response('bundle'),
    open: async () => { await gate; return { put: async (_, response) => { saved = await response.text(); } }; } });
  const response = await w.request('/assets/index-12345678.js');
  assert.equal(await response.text(), 'bundle');
  release(); await Promise.all(w.lifetime);
  assert.equal(saved, 'bundle');
});

test('recursos con hash reutilizan caché, pero HTML y versión buscan novedades', async () => {
  let calls = 0;
  const w = await worker({ fetch: async () => { calls++; return new Response('new'); }, match: async () => new Response('cached') });
  assert.equal(await (await w.request('/assets/index-12345678.js')).text(), 'cached');
  assert.equal(calls, 0);
  assert.equal(await (await w.request('/', 'navigate')).text(), 'new');
  assert.equal(calls, 1);
  assert.equal(w.request('/version.json?t=123'), undefined);
});

test('sin red ni caché el worker devuelve un error de red válido', async () => {
  const w = await worker({ fetch: async () => { throw new Error('offline'); } });
  assert.equal((await w.request('/missing.png')).type, 'error');
});

test('sonido silenciado persiste y no crea audio; al activarlo libera cada nodo', async () => {
  let stored = 'off', contexts = 0, resumed = 0, disconnected = 0;
  const oscillators = [];
  class AudioContext {
    constructor() { contexts++; this.state = 'running'; this.currentTime = 0; }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    resume() { this.state = 'running'; resumed++; return Promise.resolve(); }
    createOscillator() {
      const node = { frequency: {}, connect(gain) { return gain; }, start() {}, stop() {}, disconnect() { disconnected++; } };
      oscillators.push(node); return node;
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { disconnected++; } }; }
  }
  const source = (await readFile('src/sound.js', 'utf8')).replace(/export /g, '');
  const sound = vm.runInNewContext(`${source}\n;({playCue, soundEnabled, setSoundEnabled})`, {
    window: { AudioContext }, document: { hidden: false, addEventListener() {} },
    localStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } },
  });
  sound.playCue('tick'); assert.equal(contexts, 0);
  sound.setSoundEnabled(true); sound.playCue('tick');
  assert.equal(stored, 'on'); assert.equal(contexts, 1);
  oscillators[0].onended(); assert.equal(disconnected, 2);
  sound.setSoundEnabled(false); sound.playCue('tick');
  assert.equal(stored, 'off'); assert.equal(oscillators.length, 1);
  sound.setSoundEnabled(true); sound.playCue('tick'); assert.equal(resumed, 1);
});

test('el impacto atenúa taps y la victoria conserva prioridad sobre otros efectos', async () => {
  let notes = 0, faded = 0;
  class AudioContext {
    state = 'running'; currentTime = 0;
    createOscillator() {
      notes++;
      return { frequency: {}, connect(gain) { return gain; }, start() {}, stop() {}, disconnect() {} };
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {},
      cancelScheduledValues() {}, setTargetAtTime() { faded++; } }, connect() {}, disconnect() {} }; }
  }
  const source = (await readFile('src/sound.js', 'utf8')).replace(/export /g, '');
  const sound = vm.runInNewContext(`${source}\n;({playCue})`, {
    window: { AudioContext }, document: { hidden: false, addEventListener() {} },
  });
  sound.playCue('gameTap');
  assert.equal(notes, 2);
  sound.playCue('gameTap');
  assert.equal(notes, 2);
  sound.playCue('hit');
  assert.equal(notes, 5);
  assert.equal(faded, 2);
  sound.playCue('confirm');
  assert.equal(notes, 5);
  sound.playCue('win');
  assert.equal(notes, 9);
  assert.equal(faded, 5);
  sound.playCue('hit');
  assert.equal(notes, 9);
});
