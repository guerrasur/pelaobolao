import './style.css';
import { doc, onSnapshot } from 'firebase/firestore';
import { connect } from './firebase.js';
import { millis } from './game.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const connection = document.querySelector('#connection');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const s = { profile: undefined, room: null, roomId: null, game: null, gameId: null, intent: null,
  online: navigator.onLine, busy: false, targeting: false, choice: null, offset: 0, ready: false };
let api, roomOff, gameOff, intentOff, heartbeatBusy = false, lastContact = 0;
let pending = null, sending = false, drag = null, suppressClick = false, lastNudge = 0;
const now = () => api?.now() ?? Date.now();
const message = text => { notice.textContent = text; };
const actionName = action => ({ air: 'Tomar aire', hide: 'Esconderse', blow: 'Soplar', distracted: 'Distraído' }[action] ?? 'Sin elegir');

async function call(name, data) {
  const start = Date.now();
  const result = await api.call(name, data);
  lastContact = Date.now();
  if (result.serverNow) s.offset = result.serverNow - (start + Date.now()) / 2;
  return result;
}
function showError(error) {
  const code = error.code;
  const friendly = {
    unavailable: 'No hay conexión con el servidor. Reintentá cuando vuelva.',
    'permission-denied': 'No tenés acceso a esa sala. Volvé a entrar con el código.',
  };
  message(friendly[code] || error.message || 'No pudimos completar la operación.');
}
async function operation(fn) {
  if (s.busy) return;
  s.busy = true; render(); message('');
  try { await fn(); } catch (error) { showError(error); }
  finally { s.busy = false; render(); }
}
function subscribeGame(id) {
  if (s.gameId === id) return;
  gameOff?.(); intentOff?.(); s.gameId = id; s.game = null; s.intent = null;
  s.choice = null; pending = null; s.targeting = false;
  if (!id) return;
  gameOff = onSnapshot(doc(api.db, 'games', id), snap => {
    const oldTurn = s.game?.turn;
    s.game = snap.data();
    if (oldTurn !== s.game?.turn || s.game?.phase !== 'choosing') {
      s.choice = null; pending = null; s.targeting = false;
      message('');
    }
    render();
  }, showError);
  intentOff = onSnapshot(doc(api.db, 'games', id, 'intents', api.uid), snap => {
    s.intent = snap.data() ?? null;
    render();
  }, showError);
}
function subscribeRoom(id) {
  if (s.roomId === id) return;
  roomOff?.(); s.roomId = id; s.room = null; subscribeGame(null);
  if (!id) { render(); return; }
  roomOff = onSnapshot(doc(api.db, 'rooms', id), snap => {
    const room = snap.data();
    if (!room || room.status === 'closed' || !room.members[api.uid] || room.members[api.uid].left) {
      roomOff?.(); s.roomId = null; s.room = null; subscribeGame(null);
      message('Saliste de la sala. Podés crear otra o volver con el código.'); render(); return;
    }
    s.room = { ...room, members: Object.fromEntries(Object.entries(room.members).map(([uid, m]) => [uid, { ...m, lastSeenAt: millis(m.lastSeenAt) }])) };
    subscribeGame(room.gameId);
    render();
  }, error => {
    roomOff?.(); s.roomId = null; s.room = null; subscribeGame(null); render(); showError(error);
  });
  heartbeat();
}
async function roomCommand(command, extra = {}) {
  const result = await call('roomCommand', { command, ...(!['create', 'join'].includes(command) ? { roomId: s.roomId } : {}), ...extra });
  if (command !== 'touch') subscribeRoom(result.roomId);
}
async function heartbeat() {
  if (!api || !s.roomId || !s.online || heartbeatBusy) return;
  heartbeatBusy = true;
  try { await roomCommand('touch'); }
  catch (error) {
    if (error.code?.endsWith('permission-denied') || error.code?.endsWith('not-found')) {
      subscribeRoom(null); showError(error);
    }
  } finally { heartbeatBusy = false; }
}

function canChoose() {
  return s.online && s.game?.phase === 'choosing' && now() < s.game.deadline && s.game.players[api.uid]?.hair > 0;
}
function accepted() { return s.intent?.turn === s.game?.turn ? s.intent : null; }
function choose(action, target = null) {
  if (!canChoose()) { message('Ya no podés elegir en este turno.'); return; }
  if (action === 'blow' && (s.game.players[api.uid].breath < 1 || target === api.uid || !(s.game.players[target]?.hair > 0))) return;
  s.targeting = false;
  s.choice = { action, target, turn: s.game.turn };
  pending = { ...s.choice, gameId: s.gameId, requestId: crypto.randomUUID() };
  render(); void flushIntent();
}
async function flushIntent() {
  if (sending) return;
  sending = true;
  while (pending) {
    const next = pending; pending = null;
    if (!canChoose() || next.gameId !== s.gameId || next.turn !== s.game.turn) continue;
    try {
      const result = await call('submitIntent', { ...next, expectedRevision: accepted()?.revision ?? 0 });
      if (next.gameId === s.gameId && next.turn === s.game?.turn) {
        if (!s.intent || s.intent.turn !== result.turn || s.intent.revision <= result.revision) s.intent = result;
        if (!pending) s.choice = null;
        message('Elección guardada. Podés cambiarla hasta que termine el tiempo.');
      }
    } catch (error) {
      if (next.gameId === s.gameId && next.turn === s.game?.turn) {
        if (!pending) s.choice = null;
        showError(error);
      }
    }
    render();
  }
  sending = false; render();
}

function resultHtml(game) {
  const result = game.lastResult;
  if (!result) return '<p class="muted">Las acciones se revelan al terminar el turno.</p>';
  return `<section class="result" aria-label="Resultado del turno anterior"><h2>Turno ${result.turn} · resultado</h2><ul>${Object.entries(result.actions).map(([uid, action]) => {
    const target = action.target ? ` → ${esc(game.players[action.target]?.name)}` : '';
    const loss = result.losses[uid] ? ` · −${result.losses[uid]} Pelo` : '';
    const blocked = result.hits.find(hit => hit.from === uid)?.blocked ? ' (bloqueado)' : '';
    return `<li><strong>${esc(game.players[uid].name)}</strong>: ${actionName(action.action)}${target}${blocked}${loss}</li>`;
  }).join('')}</ul></section>`;
}

function render() {
  if (drag) return; // Keep pointer capture intact during room heartbeat snapshots.
  const active = document.activeElement;
  const focusId = active?.id;
  const inputValue = active instanceof HTMLInputElement ? active.value : null;
  const selection = inputValue !== null ? [active.selectionStart, active.selectionEnd] : null;
  const disabled = s.busy || !s.online ? 'disabled' : '';
  if (!s.ready) return;
  if (!s.profile) {
    app.innerHTML = `<section><h1>¿Cómo te llamás?</h1><p>Elegí tu nombre para jugar. Lo recordaremos en este navegador.</p><form id="profile-form"><label for="player-name">Nombre</label><input id="player-name" name="name" maxlength="24" required autocomplete="nickname" placeholder="Tu nombre"><button ${disabled}>Continuar</button></form></section>`;
  } else if (!s.roomId) {
    const joinCode = new URLSearchParams(location.search).get('s') ?? '';
    app.innerHTML = `<section><p class="eyebrow">Hola, ${esc(s.profile.name)}</p><h1>Que no te vuelen el pelo.</h1><p>De 2 a 6 jugadores. Cada uno, desde su celular.</p><button id="create-room" ${disabled}>Crear sala</button><form id="join-form"><label for="room-code">Código de sala</label><input id="room-code" name="code" maxlength="6" minlength="6" pattern="[A-Za-z2-9]{6}" value="${esc(joinCode)}" placeholder="ABC234" autocapitalize="characters" autocomplete="off" spellcheck="false" required><button class="secondary" ${disabled}>Unirse a sala</button></form></section>`;
  } else if (!s.room) {
    app.innerHTML = '<p>Entrando a la sala…</p>';
  } else if (s.room.status === 'lobby') {
    const members = Object.entries(s.room.members);
    const host = s.room.hostId === api.uid;
    app.innerHTML = `<section><p class="eyebrow">Sala de espera</p><h1>Código <span class="code">${esc(s.room.code)}</span></h1><button id="share-room" class="secondary">Compartir código</button><h2>Jugadores · ${members.length}/6</h2><ul class="lobby-list">${members.map(([uid, m]) => `<li><strong>${esc(m.name)}${uid === api.uid ? ' (vos)' : ''}</strong><span>${uid === s.room.hostId ? 'Host · ' : ''}<span data-presence="${uid}">${now() - m.lastSeenAt < 25000 ? 'Conectado' : 'Reconectando…'}</span></span></li>`).join('')}</ul>${host ? `<button id="start-game" ${disabled || (members.length < 2 ? 'disabled' : '')}>Iniciar partida</button><p class="muted">Mínimo 2 jugadores conectados para empezar.</p>` : `<p>El host inicia la partida.</p>`}<button id="leave-room" class="quiet" ${disabled}>Salir de la sala</button></section>`;
  } else if (!s.game) {
    app.innerHTML = '<p>Cargando la partida…</p>';
  } else {
    const game = s.game;
    const me = game.players[api.uid];
    const terminal = ['finished', 'abandoned'].includes(game.phase);
    const choice = s.choice?.turn === game.turn ? s.choice : accepted();
    const title = terminal ? game.phase === 'abandoned' ? 'Partida abandonada' : game.draw ? '¡Empate! Todos pelados.' : `Ganó ${esc(game.players[game.winnerId]?.name)}` : `Turno ${game.turn}`;
    app.innerHTML = `<section class="game"><div class="turn-header"><div><p class="eyebrow">Sala ${esc(s.room.code)}</p><h1>${title}</h1></div>${!terminal ? '<span id="timer" role="timer" aria-label="Tiempo restante"></span>' : ''}</div><p id="turn-status" aria-live="polite">${terminal ? game.phase === 'abandoned' ? 'La partida fue cerrada.' : 'La partida terminó.' : game.phase === 'reveal' ? 'Acciones reveladas · preparando el siguiente turno' : me?.hair > 0 ? 'Elegí en secreto. Podés cambiar tu decisión.' : 'Estás Pelado. Podés seguir mirando.'}</p><div class="players">${Object.entries(game.players).map(([uid, p]) => `<button class="player ${uid === api.uid ? 'self' : ''} ${p.hair === 0 ? 'eliminated' : ''} ${choice?.target === uid ? 'selected-target' : ''}" data-player="${uid}" ${p.hair <= 0 || uid === api.uid ? 'disabled' : ''} aria-label="${esc(p.name)}, Pelo ${p.hair}, Soplos ${p.breath}"><strong>${esc(p.name)}${uid === api.uid ? ' (vos)' : ''}</strong><span>Pelo <b>${p.hair}</b>/${game.rules.maxHair}</span><span>Soplos <b>${p.breath}</b>/${game.rules.maxBreath}</span><small>${p.hair === 0 ? 'Pelado' : s.room.members[uid]?.left || now() - (s.room.members[uid]?.lastSeenAt ?? 0) > 25000 ? 'Reconectando…' : 'En juego'}</small></button>`).join('')}</div>${!terminal && me?.hair > 0 ? `<div class="controls"><button data-action="air" ${!canChoose() ? 'disabled' : ''}>Tomar aire <small>+1 Soplo</small></button><button data-action="hide" ${!canChoose() ? 'disabled' : ''}>Esconderse <small>Abajo del banco</small></button><button id="blow" class="${s.targeting ? 'aiming' : ''}" ${!canChoose() || me.breath < 1 ? 'disabled' : ''}>Soplar <small>Arrastrá o tocá y elegí</small></button></div><p id="selection" aria-live="polite">${s.targeting ? 'Tocá otro jugador para elegir tu objetivo.' : choice ? `${s.choice ? 'Guardando' : 'Elegido'}: ${actionName(choice.action)}${choice.target ? ` → ${esc(game.players[choice.target]?.name)}` : ''}` : 'Sin acción elegida · al terminar: Distraído'}</p>` : ''}${resultHtml(game)}${terminal ? s.room.hostId === api.uid ? `<button id="back-lobby" ${disabled}>Volver al lobby / revancha</button>` : '<p>Esperando al host para la revancha.</p>' : ''}<button id="leave-room" class="quiet" ${disabled}>Salir de la sala</button></section>`;
  }
  if (focusId) {
    const replacement = document.getElementById(focusId);
    if (replacement && !replacement.disabled) {
      replacement.focus({ preventScroll: true });
      if (inputValue !== null) { replacement.value = inputValue; replacement.setSelectionRange(...selection); }
    }
  }
  bind(); tick();
}

function bind() {
  document.querySelector('#profile-form')?.addEventListener('submit', event => {
    event.preventDefault(); const name = new FormData(event.target).get('name');
    operation(async () => { await call('saveProfile', { name }); });
  });
  document.querySelector('#join-form')?.addEventListener('submit', event => {
    event.preventDefault(); const code = new FormData(event.target).get('code').trim().toUpperCase();
    operation(() => roomCommand('join', { code }));
  });
  for (const [id, command] of [['create-room', 'create'], ['start-game', 'start'], ['leave-room', 'leave'], ['back-lobby', 'lobby']]) {
    document.getElementById(id)?.addEventListener('click', () => operation(() => roomCommand(command)));
  }
  document.querySelector('#share-room')?.addEventListener('click', async () => {
    const url = `${location.origin}/?s=${s.room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Pelao Bolao', text: `Sala ${s.room.code}`, url });
      else { await navigator.clipboard.writeText(url); message('Enlace de sala copiado.'); }
    } catch { message(`Código: ${s.room.code}`); }
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => choose(button.dataset.action)));
  document.querySelectorAll('[data-player]').forEach(button => button.addEventListener('click', () => {
    if (s.targeting) choose('blow', button.dataset.player);
  }));
  const blow = document.querySelector('#blow');
  if (!blow) return;
  blow.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    s.targeting = !s.targeting; render();
  });
  blow.addEventListener('pointerdown', event => {
    if (!canChoose() || event.button !== 0) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, target: null,
      gameId: s.gameId, turn: s.game.turn };
    blow.setPointerCapture(event.pointerId);
  });
  blow.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
    if (!drag.moved) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-player]');
    drag.target = target && !target.disabled ? target.dataset.player : null;
    document.querySelectorAll('[data-player]').forEach(player => {
      player.classList.toggle('valid-target', !player.disabled);
      player.classList.toggle('drag-target', player.dataset.player === drag.target);
    });
    document.querySelector('#selection').textContent = drag.target ? `Soltá para soplar a ${s.game.players[drag.target].name}` : 'Arrastrá sobre otro jugador.';
  });
  const finish = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const previous = drag; drag = null;
    if (previous.moved) {
      suppressClick = true;
      if (event.type === 'pointerup' && previous.target && previous.gameId === s.gameId && previous.turn === s.game?.turn && canChoose()) choose('blow', previous.target);
      else { message('Arrastre cancelado. Se conserva tu elección anterior.'); render(); }
      setTimeout(() => { suppressClick = false; }, 0);
    } else if (event.type !== 'pointerup') render();
  };
  blow.addEventListener('pointerup', finish);
  blow.addEventListener('pointercancel', finish);
  blow.addEventListener('lostpointercapture', event => { if (drag) finish(event); });
}

function tick() {
  connection.textContent = !s.online ? 'Sin conexión · reconectando al volver la señal' : lastContact && Date.now() - lastContact > 30000 && s.roomId ? 'Comprobando conexión con el servidor…' : api ? 'Conectado' : 'Conectando…';
  connection.classList.toggle('offline', !s.online);
  document.querySelectorAll('[data-presence]').forEach(el => {
    const member = s.room?.members[el.dataset.presence];
    el.textContent = member && now() - member.lastSeenAt < 25000 ? 'Conectado' : 'Reconectando…';
  });
  if (!s.game) return;
  const deadline = s.game.phase === 'reveal' ? s.game.nextTurnAt : s.game.deadline;
  const seconds = Math.max(0, Math.ceil((deadline - now()) / 1000));
  const timer = document.querySelector('#timer');
  if (timer) timer.textContent = `${seconds}s`;
  if (s.game.phase === 'choosing' && seconds === 0) {
    document.querySelector('#turn-status').textContent = 'Tiempo terminado · esperando resolución del host';
    document.querySelectorAll('.controls button').forEach(button => { button.disabled = true; });
  }
  // Only the current host attempts resolution. Firestore rechecks authority atomically.
  if (s.room?.hostId === api.uid && s.online && ['choosing', 'reveal'].includes(s.game.phase) && now() > deadline + 150 && Date.now() - lastNudge > 1500) {
    lastNudge = Date.now(); call('advanceGame', { gameId: s.gameId, turn: s.game.turn, phase: s.game.phase }).catch(showError);
  }
}

window.addEventListener('offline', () => { s.online = false; pending = null; s.choice = null; render(); });
window.addEventListener('online', () => { s.online = true; heartbeat(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { heartbeat(); tick(); } });
setInterval(tick, 200);
setInterval(heartbeat, 10000);
try {
  api = await connect();
  onSnapshot(doc(api.db, 'profiles', api.uid), snap => { s.profile = snap.data() ?? null; s.ready = true; render(); }, showError);
  onSnapshot(doc(api.db, 'sessions', api.uid), snap => { subscribeRoom(snap.data()?.roomId ?? null); }, showError);
} catch (error) {
  app.innerHTML = `<section><h1>No pudimos iniciar</h1><p>${esc(error.message)}</p><button onclick="location.reload()">Reintentar</button></section>`;
  connection.textContent = 'No conectado';
}
