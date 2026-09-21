import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { millis, phaseDeadline, allMarked, SYNC_WAIT_MS, ABANDON_MS } from '../src/game.js';
import { playerCard as renderPlayerCard } from '../src/visuals.js';

// Execute the real UI controller with a minimal DOM and controllable network.
// No Firebase permissions or emulator behavior is simulated by these tests.
async function setup(handler = async () => ({})) {
  const nodes = new Map(['#app', '#notice', '#connection', '#app-meta'].map(id => [id, {
    innerHTML: '', textContent: '', classList: { toggle() {} },
  }]));
  const calls = [], subscriptions = [], events = {};
  const api = { uid: 'me', db: {}, now: Date.now, syncClock: async () => {},
    call: async (name, data) => { calls.push({ name, data }); return handler(name, data); } };
  const context = vm.createContext({
    document: { querySelector: id => nodes.get(id) ?? null, querySelectorAll: () => [],
      getElementById: () => null, activeElement: null, hidden: false,
      addEventListener: (event, fn) => { events[event] = fn; } },
    window: { addEventListener: (event, fn) => { events[event] = fn; } },
    navigator: { onLine: true }, location: { search: '', href: 'http://test/', origin: 'http://test' },
    HTMLInputElement: class {}, URL, URLSearchParams, setInterval: () => {},
    fetch: async () => ({ ok: false }),
    doc: (_db, ...parts) => parts.join('/'),
    onSnapshot: (path, ...args) => {
      const [next, error] = args.filter(arg => typeof arg === 'function');
      const sub = { path, next, error, active: true }; subscriptions.push(sub);
      return () => { sub.active = false; };
    },
    connect: async () => api, millis, phaseDeadline, allMarked, SYNC_WAIT_MS, ABANDON_MS,
    playerCard: () => '', actionControls: () => '', playCue: () => {}, packageInfo: { version: 'test' },
  });
  const source = (await readFile('src/main.js', 'utf8')).replace(/^import .*;\n/gm, '');
  const ui = await vm.runInContext(`(async () => { ${source}\nreturn { s, leaveRoom, resetRoomSession, roomCommand, subscribeRoom, subscribeGame, operation, tick, render }; })()`, context);
  Object.assign(ui.s, { ready: true, nameConfirmed: true, profile: { name: 'Ana' } });
  ui.render();
  return { ...ui, nodes, calls, subscriptions, events };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { promise, resolve, reject }; };

test('abrir la web no recupera automáticamente la sesión remota', async () => {
  const ui = await setup();
  assert.equal(ui.subscriptions.some(sub => sub.path.startsWith('sessions/')), false);
  assert.equal(ui.s.roomId, null);
  assert.match(ui.nodes.get('#app').innerHTML, /Crear sala/);
});

test('salir funciona sin conexión aunque limpieza y salida queden pendientes', async () => {
  const ui = await setup(() => new Promise(() => {}));
  ui.subscribeRoom('ABCD'); ui.events.offline();
  ui.s.busy = true;
  ui.leaveRoom();
  assert.equal(ui.s.roomId, null);
  assert.equal(ui.s.game, null);
  assert.equal(ui.s.busy, false);
  assert.match(ui.nodes.get('#app').innerHTML, /Crear sala/);
  assert.equal(ui.subscriptions.filter(sub => sub.path === 'rooms/ABCD').every(sub => !sub.active), true);
});

test('una respuesta vieja no vuelve a meter al jugador ni desbloquea una operación nueva', async () => {
  const old = deferred(), current = deferred();
  const ui = await setup((name, data) => name === 'roomCommand' && data.command === 'join' ? old.promise : {});
  const pending = ui.operation(() => ui.roomCommand('join', { code: 'ABCD' }));
  ui.resetRoomSession();
  const newer = ui.operation(() => current.promise);
  old.resolve({ roomId: 'ABCD' }); await pending;
  assert.equal(ui.s.roomId, null);
  assert.equal(ui.s.busy, true);
  current.resolve(); await newer;
  assert.equal(ui.s.busy, false);
});

test('denegación de acceso a la partida vuelve al inicio aun si falla limpiar sesión', async () => {
  const ui = await setup(async name => {
    if (name === 'clearRoomSession') throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    return {};
  });
  ui.subscribeRoom('ABCD'); ui.subscribeGame('game-1');
  ui.subscriptions.find(sub => sub.path === 'games/game-1').error({ code: 'permission-denied' });
  await Promise.resolve();
  assert.equal(ui.s.roomId, null);
  assert.equal(ui.s.gameId, null);
  assert.match(ui.nodes.get('#app').innerHTML, /Crear sala/);
});

test('volver de otra pestaña conserva la sala actual', async () => {
  const ui = await setup();
  ui.subscribeRoom('ABCD');
  ui.events.visibilitychange();
  assert.equal(ui.s.roomId, 'ABCD');
  assert.equal(ui.calls.some(call => call.name === 'clearRoomSession'), false);
});

test('una partida vencida vuelve al inicio aunque falle su cierre remoto', async () => {
  const ui = await setup(async () => { throw new Error('offline'); });
  ui.s.roomId = 'ABCD'; ui.s.gameId = 'game-1';
  ui.s.game = { phase: 'finished', finishedAt: Date.now() - ABANDON_MS - 1000 };
  ui.tick(); await Promise.resolve();
  assert.equal(ui.s.roomId, null);
  assert.match(ui.nodes.get('#notice').textContent, /inactividad/);
});


test('el lobby expone progreso de listos y presencia sin revelar acciones', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId = 'ABCD';
  ui.s.room = {
    code: 'ABCD', status: 'lobby', hostId: 'me',
    members: {
      me: { name: 'Ana', ready: true, lastSeenAt: now },
      other: { name: 'Beto', ready: false, lastSeenAt: now - 30000 },
    },
  };
  ui.render();
  const html = ui.nodes.get('#app').innerHTML;
  assert.match(html, /1\/2 listos/);
  assert.match(html, /data-presence="me"/);
  assert.match(html, /data-presence="other"/);
  assert.match(html, /Reconectando/);
  assert.doesNotMatch(html, /Soplar →/);
});

test('tarjetas toleran índices heredados y distinguen crítico, desconexión y bloqueos', () => {
  const base = { uid:'legacy', player:{ name:'Rival', hair:1, breath:0 }, index:-1, self:false, selected:false, chosen:false,
    connected:false, rules:{ maxHair:4, maxBreath:2 } };
  const card = renderPlayerCard({ ...base, effects:{ blockedAttack:true } });
  assert.match(card, /critical/);
  assert.match(card, /offline-player/);
  assert.match(card, /--seat-color:#fa4563/);
  assert.match(card, />1<\/i>/);
  assert.match(card, /¡BLOQUEADO!/);
  const defense = renderPlayerCard({ ...base, connected:true, effects:{ blockedDefense:true } });
  assert.match(defense, /¡ATAJÓ!/);
  const winner = renderPlayerCard({ ...base, player:{ ...base.player, hair:2 }, connected:true, winner:true, effects:{ action:'air' } });
  assert.match(winner, /player [^"]*winner/);
  assert.match(winner, /rx="3\.7"/);
  const self = renderPlayerCard({ ...base, self:true, connected:true, effects:{} });
  assert.match(self, /self-tag">VOS/);
  assert.doesNotMatch(self, /\(vos\)/);
});


test('modo objetivo expone una guía clara sin revelar elecciones ajenas', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId = 'ABCD';
  ui.s.room = { code:'ABCD', status:'playing', hostId:'me', members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId = 'g1';
  ui.s.game = {
    phase:'choosing', turn:1, protocolVersion:2, phaseStartedAt:now,
    deadline:now+8000, memberIds:['me','other'], chosen:{}, ready:{},
    players:{ me:{name:'Ana',hair:3,breath:1}, other:{name:'Beto',hair:3,breath:0} },
    rules:{ maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500 },
  };
  ui.s.targeting = true;
  ui.render();
  const html = ui.nodes.get('#app').innerHTML;
  assert.match(html, /data-targeting="true"/);
  assert.match(html, /Modo objetivo activo/);
  assert.doesNotMatch(html, /Beto.*Tomar aire/);
});
