import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { millis, phaseDeadline, allMarked, lobbyReturnSeconds, SYNC_WAIT_MS, ABANDON_MS, GAME_HOST_LEASE_MS, CENTER_ITEM_TARGET, HAIR_ITEM_KIND } from '../src/game.js';
import { playerCard as renderPlayerCard } from '../src/visuals.js';
import { isNewerVersion } from '../src/version.js';
import { dragGuideGeometry, shouldHoldRenderForDrag } from '../src/condor-core.js';

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
    connect: async () => api, millis, phaseDeadline, allMarked, lobbyReturnSeconds, SYNC_WAIT_MS, ABANDON_MS, GAME_HOST_LEASE_MS, CENTER_ITEM_TARGET, HAIR_ITEM_KIND, isNewerVersion, dragGuideGeometry, shouldHoldRenderForDrag,
    playerCard: () => '', actionControls: () => '', playCue: () => {}, packageInfo: { version: 'test' },
  });
  const source = (await readFile('src/main.js', 'utf8')).replace(/^import .*;\n/gm, '');
  const ui = await vm.runInContext(`(async () => { ${source}\nreturn { s, leaveRoom, resetRoomSession, roomCommand, subscribeRoom, subscribeGame, operation, heartbeat, tick, render }; })()`, context);
  Object.assign(ui.s, { ready: true, nameConfirmed: true, profile: { name: 'Ana' } });
  ui.render();
  return { ...ui, nodes, calls, subscriptions, events };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { promise, resolve, reject }; };

test('Plan Cóndor 0.22: render no conserva el guard global que anulaba cambios críticos durante un drag', async () => {
  const source = await readFile('src/main.js', 'utf8');
  assert.doesNotMatch(source, /function render\(\) \{\s*if \(drag\) return/);
  assert.match(source, /shouldHoldRenderForDrag\(Boolean\(drag\), s\.game\?\.phase, Boolean\(s\.updateRequired\)\)/);
});

test('Plan Cóndor 0.22: el HUD evita reescribir texto idéntico en cada tick', async () => {
  const source = await readFile('src/main.js', 'utf8');
  assert.match(source, /const setText = \(node, value\) =>/);
  assert.match(source, /if \(node\.textContent === next\) return false/);
  assert.match(source, /setText\(timer,/);
  assert.match(source, /setText\(document\.querySelector\('#selection'\),/);
});

test('abrir la web no recupera automáticamente la sesión remota', async () => {
  const ui = await setup();
  assert.equal(ui.subscriptions.some(sub => sub.path.startsWith('sessions/')), false);
  assert.equal(ui.s.roomId, null);
  assert.match(ui.nodes.get('#app').innerHTML, /id="create-room"/);
});

test('salir funciona sin conexión aunque limpieza y salida queden pendientes', async () => {
  const ui = await setup(() => new Promise(() => {}));
  ui.subscribeRoom('ABCD'); ui.events.offline();
  ui.s.busy = true;
  ui.leaveRoom();
  assert.equal(ui.s.roomId, null);
  assert.equal(ui.s.game, null);
  assert.equal(ui.s.busy, false);
  assert.match(ui.nodes.get('#app').innerHTML, /id="create-room"/);
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
  assert.match(ui.nodes.get('#app').innerHTML, /id="create-room"/);
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
  assert.match(html, /data-member="me" data-ready="true"/);
  assert.match(html, /data-member="other" data-ready="false"/);
  assert.match(html, /Reconectando/);
  assert.match(html, /lobby-self-tag">VOS/);
  assert.doesNotMatch(html, /Ana \(vos\)/);
  assert.doesNotMatch(html, /Soplar →/);
});

test('el lobby conserva el orden de ingreso aunque cambien Listo y presencia', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId = 'ABCD';
  ui.s.room = {
    code:'ABCD', status:'lobby', hostId:'me',
    members:{
      third:{name:'Cami',ready:true,joinedAt:300,lastSeenAt:now},
      me:{name:'Ana',ready:false,joinedAt:100,lastSeenAt:now},
      second:{name:'Beto',ready:true,joinedAt:200,lastSeenAt:now - 30000},
    },
  };
  ui.render();
  let html = ui.nodes.get('#app').innerHTML;
  assert.ok(html.indexOf('Ana') < html.indexOf('Beto'));
  assert.ok(html.indexOf('Beto') < html.indexOf('Cami'));
  assert.match(html, /lobby-slot[^>]*>1<\/span>.*Ana/s);
  assert.match(html, /Beto.*Reconectando/s);

  ui.s.room.members.me.ready = true;
  ui.s.room.members.second.ready = false;
  ui.s.room.members.second.lastSeenAt = now;
  ui.render();
  html = ui.nodes.get('#app').innerHTML;
  assert.ok(html.indexOf('Ana') < html.indexOf('Beto'));
  assert.ok(html.indexOf('Beto') < html.indexOf('Cami'));
});

test('tarjetas toleran índices heredados y distinguen crítico, desconexión y bloqueos', () => {
  const base = { uid:'legacy', player:{ name:'Rival', hair:1, breath:0 }, index:-1, self:false, selected:false, chosen:false,
    connected:false, rules:{ maxHair:4, maxBreath:2 } };
  const card = renderPlayerCard({ ...base, effects:{ blockedAttack:true } });
  assert.match(card, / disabled>/);
  const targetable = renderPlayerCard({ ...base, targetable:true, effects:{} });
  assert.match(targetable, /targetable/);
  assert.doesNotMatch(targetable, / disabled>/);
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
  const self = renderPlayerCard({ ...base, self:true, connected:true, chosen:true, effects:{} });
  assert.match(self, /self-tag">VOS/);
  assert.match(self, /player-label" title="Rival \(vos\)">Rival<\/span>/);
  assert.match(self, /has-chosen/);
  assert.match(self, /hair-resource/);
  assert.match(self, /breath-resource/);
  assert.match(self, /--hair-fill:0\.25/);
  const selected = renderPlayerCard({ ...base, connected:true, selected:true, effects:{} });
  assert.match(selected, /selected-target/);
  assert.doesNotMatch(selected, /attack-target-badge/);
  assert.doesNotMatch(selected, /ATAQUE ELEGIDO/);
  const grabbing = renderPlayerCard({ ...base, connected:true, effects:{ action:'grab' } });
  assert.match(grabbing, /action-grab/);
  assert.match(grabbing, /fx-grab/);
  assert.match(grabbing, /fx-label-grab/);
  assert.match(grabbing, /¡AGARRA!/);
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
  assert.match(html, /¡APUNTÁ!/);
  assert.match(html, /Tocá SOPLAR de nuevo para cancelar/);
  assert.doesNotMatch(html, /Beto.*Tomar aire/);
});


test('resultado usa chips del juego y prompts cortos sin emojis decorativos', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId = 'ABCD';
  ui.s.room = { code:'ABCD', status:'playing', hostId:'me', members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId = 'g1';
  ui.s.game = {
    phase:'reveal', turn:2, protocolVersion:2, phaseStartedAt:now,
    memberIds:['me','other'], chosen:{ me:true, other:true }, ready:{},
    players:{ me:{name:'Ana',hair:3,breath:1}, other:{name:'Beto',hair:2,breath:0} },
    rules:{ maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500 },
    lastResult:{
      turn:2,
      actions:{ me:{action:'blow',target:'other'}, other:{action:'distracted'} },
      hits:[{from:'me',to:'other',blocked:false}],
      losses:{other:1},
    },
  };
  ui.render();
  const html = ui.nodes.get('#app').innerHTML;
  assert.match(html, /data-kind="blow"/);
  assert.match(html, /data-kind="distracted"/);
  assert.match(html, /data-kind="damage"/);
  assert.match(html, /VOLÓ PELO/);
  assert.doesNotMatch(html, /💨|🫁|🪑|🛡|✂/);
});


test('final de partida diferencia victoria, derrota y muestra ganador aparte', async () => {
  const makeGame = winnerId => ({
    phase:'finished', turn:4, protocolVersion:2, phaseStartedAt:Date.now(), winnerId, draw:false,
    memberIds:['me','other'], chosen:{}, ready:{},
    players:{ me:{name:'Ana',hair:winnerId==='me'?1:0,breath:0}, other:{name:'Beto',hair:winnerId==='other'?1:0,breath:0} },
    rules:{ maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500 },
    lastResult:{ turn:4, actions:{ me:{action:'distracted'}, other:{action:'distracted'} }, hits:[], losses:{} },
  });
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';

  ui.s.game=makeGame('me');
  ui.render();
  let html=ui.nodes.get('#app').innerHTML;
  assert.match(html, /data-outcome="win"/);
  assert.match(html, /¡GANASTE!/);
  assert.match(html, /class="confetti"/);

  ui.s.game=makeGame('other');
  ui.render();
  html=ui.nodes.get('#app').innerHTML;
  assert.match(html, /data-outcome="lose"/);
  assert.match(html, /PERDISTE/);
  assert.match(html, /outcome-winner">Ganó <b>Beto<\/b>/);
  assert.match(html, /class="tomato"/);
});


test('jugador pelado entra en modo espectador sin controles de acción', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'other',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
    third:{name:'Cami',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'choosing',turn:3,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other','third'],chosen:{},ready:{},
    players:{
      me:{name:'Ana',hair:0,breath:0},
      other:{name:'Beto',hair:2,breath:1},
      third:{name:'Cami',hair:1,breath:0},
    },
    rules:{maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500},
  };
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/PELADO · MIRANDO/);
  assert.match(html,/2 siguen con Pelo/);
  assert.doesNotMatch(html,/class="controls"/);
});


test('countdown muestra splash de tiza sin reemplazar el tablero', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'countdown',turn:1,protocolVersion:2,phaseStartedAt:now,deadline:now+3000,
    memberIds:['me','other'],chosen:{},ready:{},
    players:{me:{name:'Ana',hair:3,breath:0},other:{name:'Beto',hair:3,breath:0}},
    rules:{maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500},
  };
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/countdown-splash/);
  assert.match(html,/data-countdown-splash/);
  assert.match(html,/¡PREPARATE!/);
});


test('late joiner sees next-match queue position while active players see the same compact queue', async () => {
  const now = Date.now();
  const baseGame = {
    phase:'choosing',turn:2,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['host','other'],chosen:{},ready:{},
    players:{host:{name:'Host',hair:3,breath:1},other:{name:'Beto',hair:2,breath:0}},
    rules:{maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500},
  };

  const watcher = await setup();
  watcher.s.roomId='ABCD';
  watcher.s.room={code:'ABCD',status:'playing',hostId:'host',members:{
    host:{name:'Host',ready:true,joinedAt:100,lastSeenAt:now},
    other:{name:'Beto',ready:true,joinedAt:200,lastSeenAt:now},
    me:{name:'Ana',ready:false,joinedAt:300,lastSeenAt:now},
    next:{name:'Cami',ready:false,joinedAt:400,lastSeenAt:now},
  }};
  watcher.s.gameId='g1';
  watcher.s.game=baseGame;
  watcher.render();
  let html=watcher.nodes.get('#app').innerHTML;
  assert.match(html,/ESPECTADOR · PRÓXIMA PARTIDA/);
  assert.match(html,/Lugar 1 de 2/);
  assert.match(html,/data-waiting-ids="me,next"/);
  assert.match(html,/PRÓXIMA/);
  assert.match(html,/Ana, Cami/);
  assert.doesNotMatch(html,/class="controls"/);

  const player = await setup();
  player.s.roomId='ABCD';
  player.s.room={...watcher.s.room,members:{...watcher.s.room.members,me:undefined}};
  delete player.s.room.members.me;
  player.s.room.members.host={...watcher.s.room.members.host,name:'Ana'};
  player.s.gameId='g1';
  player.s.game={...baseGame,memberIds:['me','other'],players:{
    me:{name:'Ana',hair:3,breath:1},other:{name:'Beto',hair:2,breath:0},
  }};
  player.s.room.members.me={name:'Ana',ready:true,joinedAt:100,lastSeenAt:now};
  delete player.s.room.members.host;
  player.render();
  html=player.nodes.get('#app').innerHTML;
  assert.match(html,/data-waiting-ids="next"/);
  assert.match(html,/Cami/);
});


test('+1 Pelo aparece como mechón flotante y se agarra gratis sin mover tarjetas', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'choosing',turn:4,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other'],chosen:{},ready:{},
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:4,source:'random'},
    players:{me:{name:'Ana',hair:2,breath:0},other:{name:'Beto',hair:3,breath:0}},
    rules:{version:3,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.s.targeting=false;
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.doesNotMatch(html,/center-item-slot/);
  assert.match(html,/class="center-item hair-item free-pickup targetable/);
  assert.match(html,/data-center-item="__center_item__"/);
  assert.match(html,/class="hair-tuft"/);
  assert.match(html,/>\+1 PELO<\/strong>/);
  assert.match(html,/AGARRAR/);
  assert.match(html,/gratis; al hacerlo quedás expuesto/);
  assert.doesNotMatch(html,/1 SOPLO/);
});

test('Plan Condor 0.25: el mechón parpadea en su tercera ronda y avisa que va a desaparecer', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'choosing',turn:6,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other'],chosen:{},ready:{},
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:4,source:'random'},
    players:{me:{name:'Ana',hair:2,breath:0,hideStreak:0},other:{name:'Beto',hair:3,breath:0,hideStreak:0}},
    rules:{version:4,maxHair:4,maxBreath:2,maxConsecutiveHides:3,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/center-item hair-item free-pickup targetable[^"]*is-expiring/);
  assert.match(html,/data-item-age="3"/);
  assert.match(html,/ÚLTIMA RONDA/);
  assert.match(html,/si nadie lo agarra ahora, desaparece/);
});

test('Plan Condor 0.25: Esconderse queda bloqueado después de tres defensas seguidas', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'choosing',turn:7,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other'],chosen:{},ready:{},centerItem:null,
    players:{me:{name:'Ana',hair:2,breath:1,hideStreak:3},other:{name:'Beto',hair:3,breath:0,hideStreak:0}},
    rules:{version:4,maxHair:4,maxBreath:2,maxConsecutiveHides:3,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/data-action="hide" class="hide-locked /);
  assert.match(html,/LÍMITE 3/);
  assert.match(html,/Esconderse bloqueado: ya van 3 seguidas/);
});

test('Plan Condor 0.18: elegir Agarrar usa estado verde y al apuntar Soplar deshabilita el mechón', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'choosing',turn:4,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other'],chosen:{},ready:{},
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:4,source:'random'},
    players:{me:{name:'Ana',hair:2,breath:1},other:{name:'Beto',hair:3,breath:0}},
    rules:{version:3,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.s.choice={action:'grab',target:CENTER_ITEM_TARGET,turn:4};
  ui.render();
  let html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/selected-grab/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/>YENDO…<\/span>/);
  assert.doesNotMatch(html,/selected-target/);

  ui.s.choice=null;
  ui.s.targeting=true;
  ui.render();
  html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/data-center-item="__center_item__"[^>]*tabindex="-1" disabled/);
  assert.doesNotMatch(html,/center-item hair-item free-pickup targetable/);
});

test('Plan Condor 0.18: una partida v2 conserva el objeto como objetivo de Soplar', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'choosing',turn:3,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other'],chosen:{},ready:{},
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:3,source:'legacy'},
    players:{me:{name:'Ana',hair:2,breath:1},other:{name:'Beto',hair:3,breath:0}},
    rules:{version:2,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.s.targeting=true;
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/center-item hair-item legacy-blow-item targetable/);
  assert.doesNotMatch(html,/tabindex="-1" disabled/);
  assert.match(html,/Tocá un rival o el \+1 Pelo del centro/);
});

test('resultado del objeto distingue curación, disputa y permanencia', async () => {
  const ui = await setup();
  const now=Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  const base={
    phase:'reveal',turn:3,protocolVersion:2,phaseStartedAt:now,
    memberIds:['me','other'],chosen:{me:true,other:true},ready:{},centerItem:null,
    players:{me:{name:'Ana',hair:3,breath:0},other:{name:'Beto',hair:3,breath:0}},
    rules:{version:3,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.s.game={...base,lastResult:{
    turn:3,actions:{me:{action:'grab',target:CENTER_ITEM_TARGET},other:{action:'hide',target:null}},
    hits:[],losses:{me:0,other:0},heals:{me:1},
    item:{kind:HAIR_ITEM_KIND,outcome:'claimed',attempts:['me'],winnerId:'me',healed:1,claimantAlive:true,spawnedTurn:3},
  }};
  ui.render();
  let html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/PELO RECUPERADO/);
  assert.match(html,/Ana recuperó 1 Pelo/);
  assert.match(html,/data-kind="heal"/);
  assert.match(html,/Agarrar \+1 Pelo/);

  ui.s.game={...base,lastResult:{
    turn:3,actions:{me:{action:'grab',target:CENTER_ITEM_TARGET},other:{action:'grab',target:CENTER_ITEM_TARGET}},
    hits:[],losses:{me:0,other:0},heals:{},
    item:{kind:HAIR_ITEM_KIND,outcome:'contested',attempts:['me','other'],winnerId:null,healed:0,spawnedTurn:3},
  }};
  ui.render();
  html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/OBJETO DISPUTADO/);
  assert.match(html,/2 fueron por él/);
});


test('Plan Aguila 0.17: el item explica riesgo gratuito y no se renderiza encima del final de partida', async () => {
  const ui=await setup();
  const now=Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  const base={
    turn:3,protocolVersion:2,phaseStartedAt:now,deadline:now+8000,
    memberIds:['me','other'],chosen:{},ready:{},
    centerItem:{kind:HAIR_ITEM_KIND,spawnedTurn:3,source:'random'},
    players:{me:{name:'Ana',hair:4,breath:1},other:{name:'Beto',hair:2,breath:0}},
    rules:{version:3,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.s.game={...base,phase:'choosing'};
  ui.render();
  let html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/MECHÓN \+1/);
  assert.match(html,/No cuesta Soplos/);
  assert.match(html,/quedás expuesto/);
  assert.match(html,/item-new-badge">NUEVO/);
  assert.match(html,/aria-disabled="false"/);

  ui.s.game={...base,phase:'finished',winnerId:'me',draw:false,finishedAt:now,lastResult:{
    turn:3,actions:{me:{action:'hide',target:null},other:{action:'distracted',target:null}},
    hits:[],losses:{me:0,other:0},heals:{},item:{kind:HAIR_ITEM_KIND,outcome:'stayed',attempts:[],winnerId:null,healed:0,spawnedTurn:3},
  }};
  ui.render();
  html=ui.nodes.get('#app').innerHTML;
  assert.doesNotMatch(html,/class="center-item hair-item/);
  assert.match(html,/¡GANASTE!/);
});

test('Plan Aguila 0.17: el resumen separa ataques de intentos de agarrar y comunica el intercambio de Pelo', async () => {
  const ui=await setup();
  const now=Date.now();
  ui.s.roomId='ABCD';
  ui.s.room={code:'ABCD',status:'playing',hostId:'me',members:{
    me:{name:'Ana',ready:true,lastSeenAt:now},
    other:{name:'Beto',ready:true,lastSeenAt:now},
    third:{name:'Cami',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId='g1';
  ui.s.game={
    phase:'reveal',turn:4,protocolVersion:2,phaseStartedAt:now,
    memberIds:['me','other','third'],chosen:{me:true,other:true,third:true},ready:{},centerItem:null,
    players:{me:{name:'Ana',hair:2,breath:0},other:{name:'Beto',hair:3,breath:0},third:{name:'Cami',hair:3,breath:0}},
    rules:{version:3,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
    lastResult:{
      turn:4,
      actions:{
        me:{action:'grab',target:CENTER_ITEM_TARGET},
        other:{action:'blow',target:'me'},
        third:{action:'hide',target:null},
      },
      hits:[{from:'other',to:'me',blocked:false}],
      losses:{me:1,other:0,third:0},
      heals:{me:1},
      item:{kind:HAIR_ITEM_KIND,outcome:'claimed',attempts:['me'],winnerId:'me',healed:1,claimantAlive:true,spawnedTurn:4},
    },
  };
  ui.render();
  const html=ui.nodes.get('#app').innerHTML;
  assert.match(html,/PELO VA, PELO VIENE/);
  assert.match(html,/data-kind="blow"><b>ATAQUE<\/b> 1/);
  assert.match(html,/data-kind="item"><b>MECHÓN<\/b> 1/);
  assert.match(html,/data-kind="damage"/);
  assert.match(html,/data-kind="heal"/);
});


test('Plan Condor: locked muestra la jugada local sellada sin reabrir controles', async () => {
  const ui = await setup();
  const now = Date.now();
  ui.s.roomId = 'ABCD';
  ui.s.room = { code:'ABCD', status:'playing', hostId:'me', members:{
    me:{name:'Ana',ready:true,lastSeenAt:now}, other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  ui.s.gameId = 'g1';
  ui.s.game = {
    phase:'locked', turn:2, protocolVersion:2, phaseStartedAt:now, memberIds:['me','other'],
    chosen:{me:true,other:true}, ready:{}, centerItem:null,
    players:{me:{name:'Ana',hair:3,breath:0},other:{name:'Beto',hair:3,breath:0}},
    rules:{version:3,maxHair:4,maxBreath:2,turnMs:8000,countdownMs:3000,revealMs:2500,centerItems:true},
  };
  ui.s.intent = { turn:2, action:'blow', target:'other', revision:1 };
  ui.render();
  const html = ui.nodes.get('#app').innerHTML;
  assert.match(html,/JUGADA SELLADA/);
  assert.match(html,/Soplar → Beto/);
  assert.doesNotMatch(html,/class="controls"/);
});

test('Plan Condor: heartbeat pasivo se limita y el heartbeat forzado evita esperar al failover', async () => {
  const ui = await setup(async (name, data) => name === 'roomCommand' && data.command === 'touch' ? { roomId:'ABCD' } : {});
  const now = Date.now();
  ui.s.roomId = 'ABCD';
  ui.s.room = { code:'ABCD', status:'playing', hostId:'other', members:{
    me:{name:'Ana',ready:true,lastSeenAt:now}, other:{name:'Beto',ready:true,lastSeenAt:now},
  }};
  await ui.heartbeat(true);
  await ui.heartbeat();
  let touches = ui.calls.filter(call => call.name === 'roomCommand' && call.data.command === 'touch');
  assert.equal(touches.length, 1);
  await ui.heartbeat(true);
  touches = ui.calls.filter(call => call.name === 'roomCommand' && call.data.command === 'touch');
  assert.equal(touches.length, 2);
});
