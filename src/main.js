import './style.css';
import { doc, onSnapshot } from 'firebase/firestore';
import { connect } from './firebase.js';
import { millis, phaseDeadline, allMarked, GAME_HOST_LEASE_MS, ABANDON_MS } from './game.js';
import { playerCard, actionControls } from './visuals.js';
import { playCue } from './sound.js';
import packageInfo from '../package.json';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const connection = document.querySelector('#connection');
const appMeta = document.querySelector('#app-meta');
const APP_VERSION = packageInfo.version;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const s = { profile: undefined, room: null, roomId: null, game: null, gameId: null, intent: null,
  online: navigator.onLine, busy: false, targeting: false, choice: null, offset: 0, ready: false,
  nameConfirmed: false, resetting: false, updateRequired: null, updating: false, bootError: null, gameError: null };
let api, roomOff, gameOff, intentOff, heartbeatBusy = false, lastContact = 0;
let roomGeneration = 0, gameGeneration = 0, advancing = false, acknowledging = false, abandoning = false, lastAck = 0, lastAbandonAttempt = 0, lastPhase;
let operationGeneration = 0;
let renderedHtml;
let pending = null, sending = false, drag = null, suppressClick = false, lastNudge = 0;
const now = () => api?.now() ?? Date.now();
const message = text => { notice.textContent = text; };
const actionName = action => ({ air: 'Tomar aire', hide: 'Esconderse', blow: 'Soplar', distracted: 'Distraído' }[action] ?? 'Sin elegir');
const choiceName = choice => `${actionName(choice.action)}${choice.target ? ` → ${s.game?.players[choice.target]?.name ?? 'jugador'}` : ''}`;
const memberOnline = uid => { const member = s.room?.members?.[uid]; return Boolean(member && now() - member.lastSeenAt < 25000); };
const vibrate = pattern => { try { if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern); } catch {} };
appMeta.textContent = `MVP · v${APP_VERSION}`;

async function checkVersion() {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const latest = (await response.json()).version;
    if (typeof latest === 'string' && latest !== APP_VERSION) {
      s.updateRequired = latest;
      cancelDrag(); pending = null; s.choice = null; s.targeting = false;
      render();
    }
  } catch {
    // A network failure does not erase an already detected mandatory update.
  }
}

async function installUpdate() {
  if (s.updating) return;
  s.updating = true; render();
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } finally {
    const url = new URL(location.href);
    url.searchParams.set('_v', s.updateRequired || Date.now());
    location.replace(url);
  }
}

async function call(name, data) {
  if (s.updateRequired && name !== 'clearRoomSession') {
    throw new Error('Actualizá la aplicación para continuar.');
  }
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
function cancelDrag() {
  const previous = drag;
  drag = null;
  const button = document.querySelector('#blow');
  if (previous && button?.hasPointerCapture(previous.pointerId)) button.releasePointerCapture(previous.pointerId);
}
function detachGame() {
  gameGeneration += 1; cancelDrag();
  gameOff?.(); intentOff?.(); gameOff = null; intentOff = null;
  s.gameId = null; s.game = null; s.intent = null; s.gameError = null;
  s.choice = null; pending = null; s.targeting = false;
}
function resetRoomSession(text = 'Volviste al inicio. Podés crear otra sala o entrar con un código.') {
  const oldRoomId = s.roomId;
  roomGeneration += 1; operationGeneration += 1;
  roomOff?.(); roomOff = null; s.roomId = null; s.room = null; detachGame();
  s.busy = false; s.resetting = false;
  message(text); render();
  // Local navigation never waits for network access or room permissions.
  if (oldRoomId) void call('clearRoomSession', { roomId: oldRoomId }).catch(() => {});
}
function leaveRoom() {
  const roomId = s.roomId;
  resetRoomSession();
  if (roomId) void call('roomCommand', { command: 'leave', roomId }).catch(() => {});
}
async function operation(fn) {
  if (s.busy || s.resetting || s.updateRequired) return;
  const generation = ++operationGeneration;
  s.busy = true; render(); message('');
  try { await fn(); } catch (error) {
    if (generation === operationGeneration) showError(error);
  } finally {
    if (generation === operationGeneration) { s.busy = false; render(); }
  }
}
function subscribeGame(id) {
  if (s.gameId === id) return;
  detachGame(); s.gameId = id; s.gameError = null;
  if (!id) return;
  const generation = gameGeneration;
  gameOff = onSnapshot(doc(api.db, 'games', id), { includeMetadataChanges: true }, snap => {
    if (generation !== gameGeneration) return;
    // Never drive timers/transitions using speculative writes or an old cached round.
    if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
    if (!snap.exists()) {
      cancelDrag(); s.game = null;
      s.gameError = 'La partida ya no existe o quedó incompleta.';
      render(); return;
    }
    const oldTurn = s.game?.turn;
    const oldPhase = s.game?.phase;
    s.game = snap.data();
    if (oldPhase && oldPhase !== s.game.phase) {
      if (s.game.phase === 'choosing') playCue('start');
      if (s.game.phase === 'reveal') {
        const impact = roundImpact(s.game);
        playCue(impact === 'hit' ? 'hit' : impact === 'block' ? 'block' : 'reveal');
        const mine = playerEffects(s.game, api.uid);
        if (mine.hit) vibrate([38, 28, 62]);
        else if (mine.blockedDefense) vibrate([22, 32, 22]);
        else if (mine.blockedAttack) vibrate(18);
      }
      if (['finished', 'abandoned'].includes(s.game.phase)) playCue('end');
    }
    lastPhase = s.game.phase;
    if (oldTurn !== s.game?.turn || s.game?.phase !== 'choosing') {
      cancelDrag(); s.choice = null; pending = null; s.targeting = false;
      lastNudge = 0;
      message('');
    }
    render();
  }, error => {
    if (generation !== gameGeneration) return;
    if (error.code?.endsWith('permission-denied') || error.code?.endsWith('not-found')) {
      resetRoomSession('Ya no tenés acceso a esa partida. Podés crear otra sala.');
      return;
    }
    cancelDrag(); s.game = null; s.gameError = 'No pudimos cargar la partida.'; render(); showError(error);
  });
  intentOff = onSnapshot(doc(api.db, 'games', id, 'intents', api.uid), snap => {
    if (generation !== gameGeneration) return;
    s.intent = snap.data() ?? null;
    render();
  }, error => {
    if (generation === gameGeneration) showError(error);
  });
}
function subscribeRoom(id) {
  if (s.roomId === id) return;
  const generation = ++roomGeneration;
  roomOff?.(); s.roomId = id; s.room = null; subscribeGame(null);
  if (!id) { render(); return; }
  roomOff = onSnapshot(doc(api.db, 'rooms', id), { includeMetadataChanges: true }, snap => {
    if (generation !== roomGeneration || snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
    const room = snap.data();
    if (!room || room.status === 'closed' || !room.members?.[api.uid] || room.members[api.uid].left) {
      void resetRoomSession('Esa sala ya no está disponible. Podés crear otra o volver con un código.');
      return;
    }
    s.room = { ...room, members: Object.fromEntries(Object.entries(room.members).map(([uid, m]) => [uid, { ...m, lastSeenAt: millis(m.lastSeenAt) }])) };
    subscribeGame(room.gameId);
    render();
  }, error => {
    if (generation !== roomGeneration) return;
    showError(error);
    void resetRoomSession('La sesión anterior no se pudo recuperar. Ya podés volver a entrar.');
  });
  heartbeat();
}
async function roomCommand(command, extra = {}) {
  const generation = roomGeneration;
  const result = await call('roomCommand', { command, ...(!['create', 'join'].includes(command) ? { roomId: s.roomId } : {}), ...extra });
  if (generation === roomGeneration && command !== 'touch') subscribeRoom(result.roomId);
}
async function heartbeat() {
  if (!api || !s.roomId || !s.online || document.hidden || s.updateRequired || heartbeatBusy) return;
  const generation = roomGeneration;
  heartbeatBusy = true;
  try { await roomCommand('touch'); }
  catch (error) {
    if (generation !== roomGeneration) return;
    if (error.code?.endsWith('permission-denied') || error.code?.endsWith('not-found')) {
      showError(error);
      void resetRoomSession('La sala dejó de estar disponible. Ya podés volver a entrar.');
    }
  } finally { heartbeatBusy = false; }
}

function canChoose() {
  return s.nameConfirmed && !s.updateRequired && !s.gameError && s.online && s.game?.phase === 'choosing'
    && Number.isFinite(phaseDeadline(s.game)) && now() < phaseDeadline(s.game)
    && !(s.game.protocolVersion === 2 && allMarked(s.game, 'chosen')) && s.game.players[api.uid]?.hair > 0;
}
function accepted() { return s.intent?.turn === s.game?.turn ? s.intent : null; }
function choose(action, target = null) {
  if (!canChoose()) { message('Ya no podés elegir en este turno.'); return; }
  if (action === 'blow' && (s.game.players[api.uid].breath < 1 || target === api.uid || !(s.game.players[target]?.hair > 0))) return;
  s.targeting = false;
  s.choice = { action, target, turn: s.game.turn };
  vibrate(action === 'blow' ? 16 : 9);
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
        message('');
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


function roundImpact(game) {
  const result = game?.lastResult;
  if (!result || !['reveal', 'finished'].includes(game.phase)) return 'none';
  if (Object.values(result.losses || {}).some(loss => Number(loss) > 0)) return 'hit';
  if ((result.hits || []).some(hit => hit.blocked)) return 'block';
  return 'reveal';
}

function playerEffects(game, uid) {
  const result = game.lastResult;
  if (!result || !['reveal', 'finished'].includes(game.phase)) return {};
  const action = result.actions?.[uid]?.action;
  const incoming = (result.hits || []).filter(hit => hit.to === uid);
  const outgoing = (result.hits || []).find(hit => hit.from === uid);
  const loss = Number(result.losses?.[uid] || 0);
  return {
    action,
    loss,
    hit: loss > 0,
    blockedDefense: incoming.some(hit => hit.blocked),
    blockedAttack: outgoing?.blocked === true,
  };
}

function resultHtml(game) {
  const result = game.lastResult;
  if (!result) return '<p class="muted">Las acciones se revelan al terminar el turno.</p>';
  const actions = Object.values(result.actions || {});
  const blows = actions.filter(action => action.action === 'blow').length;
  const breaths = actions.filter(action => action.action === 'air').length;
  const hides = actions.filter(action => action.action === 'hide').length;
  const blockedCount = (result.hits || []).filter(hit => hit.blocked).length;
  const hairLost = Object.values(result.losses || {}).reduce((total, loss) => total + Number(loss || 0), 0);
  return `<section class="result" aria-label="Resultado actual">
    <div class="result-head"><h2>Turno ${esc(result.turn)}</h2><div class="result-summary" aria-label="Resumen del turno">
      ${blows ? `<span>💨 ${blows} soplo${blows === 1 ? '' : 's'}</span>` : ''}
      ${breaths ? `<span>🫁 ${breaths} aire${breaths === 1 ? '' : 's'}</span>` : ''}
      ${hides ? `<span>🪑 ${hides} escondido${hides === 1 ? '' : 's'}</span>` : ''}
      ${blockedCount ? `<span>🛡 ${blockedCount} bloqueado${blockedCount === 1 ? '' : 's'}</span>` : ''}
      ${hairLost ? `<span class="danger">✂ −${hairLost} Pelo</span>` : '<span>Sin daño</span>'}
    </div></div>
    <ul>${Object.entries(result.actions).map(([uid, action]) => {
      const playerName = esc(game.players[uid]?.name ?? 'Jugador');
      const target = action.target ? ` → ${esc(game.players[action.target]?.name ?? 'jugador')}` : '';
      const lossValue = Number(result.losses?.[uid] || 0);
      const loss = lossValue ? ` · perdió ${lossValue} Pelo` : '';
      const blocked = (result.hits || []).find(hit => hit.from === uid)?.blocked ? ' · soplo bloqueado' : '';
      return `<li data-result-action="${esc(action.action)}" class="${lossValue ? 'result-damaged' : ''}"><strong>${playerName}</strong><span>${actionName(action.action)}${target}${blocked}${loss}</span></li>`;
    }).join('')}</ul>
  </section>`;
}

function render() {
  if (drag) return; // Keep pointer capture intact during room heartbeat snapshots.
  let html;
  const active = document.activeElement;
  const focusId = active?.id;
  const inputValue = active instanceof HTMLInputElement ? active.value : null;
  const selection = inputValue !== null ? [active.selectionStart, active.selectionEnd] : null;
  const disabled = s.busy || s.resetting || !s.online ? 'disabled' : '';
  if (s.updateRequired) {
    html = `<section class="state update-gate"><p class="eyebrow">Nueva versión v${esc(s.updateRequired)}</p><h1>Hay que actualizar para seguir</h1><p>Tu identidad se conserva. Después de actualizar podés volver a entrar con el código de la sala.</p><button id="install-update" ${s.updating ? 'disabled' : ''}>${s.updating ? 'Actualizando…' : 'Actualizar ahora'}</button></section>`;
  } else if (s.bootError) {
    html = `<section class="state"><h1>No pudimos iniciar</h1><p>${esc(s.bootError)}</p><button id="reload-app">Reintentar</button></section>`;
  } else if (!s.ready) {
    html = '<section class="state"><div class="spinner" aria-hidden="true"></div><h1>Preparando tu jugador…</h1><p class="muted">Tu sesión se conserva en este navegador.</p><button id="reload-app" class="quiet">Reintentar</button></section>';
  } else if (!s.nameConfirmed) {
    html = `<section><h1>¿Cómo te llamás?</h1><p>Confirmá tu nombre para entrar. Dejamos precargado el último que usaste.</p><form id="profile-form"><label for="player-name">Nombre</label><input id="player-name" name="name" maxlength="24" required autocomplete="nickname" placeholder="Tu nombre" value="${esc(s.profile?.name ?? '')}"><button ${disabled}>Continuar</button></form></section>`;
  } else if (!s.roomId) {
    const joinCode = new URLSearchParams(location.search).get('s') ?? '';
    html = `<section><p class="eyebrow">Hola, ${esc(s.profile.name)}</p><h1>Que no te vuelen el pelo.</h1><p>De 2 a 6 jugadores. Cada uno, desde su celular.</p><button id="create-room" ${disabled}>Crear sala</button><form id="join-form"><label for="room-code">Código de sala</label><input id="room-code" name="code" maxlength="4" minlength="4" pattern="[A-Za-z2-9]{4}" value="${esc(joinCode)}" placeholder="AB7K" autocapitalize="characters" autocomplete="off" spellcheck="false" required><button class="secondary" ${disabled}>Unirse a sala</button></form></section>`;
  } else if (!s.room) {
    html = '<section class="state"><div class="spinner" aria-hidden="true"></div><h1>Entrando a la sala…</h1><button id="reset-session" class="quiet">Volver al inicio</button></section>';
  } else if (s.room.status === 'lobby') {
    const members = Object.entries(s.room.members);
    const host = s.room.hostId === api.uid;
    const readyCount = members.filter(([, member]) => member.ready).length;
    const onlineCount = members.filter(([uid]) => memberOnline(uid)).length;
    const missingReady = Math.max(0, members.length - readyCount);
    const offlineCount = Math.max(0, members.length - onlineCount);
    const readyRatio = members.length ? readyCount / members.length : 0;
    html = `<section class="lobby-screen"><div class="lobby-heading"><div><p class="eyebrow">Sala de espera</p><h1>Código <span class="code">${esc(s.room.code)}</span></h1></div><button id="share-room" class="secondary compact-button">Compartir</button></div><div class="ready-progress" style="--ready:${readyRatio}"><div aria-hidden="true"><i></i></div><span>${readyCount}/${members.length} listos · ${onlineCount} conectados</span></div><h2>Jugadores · ${members.length}/6</h2><ul class="lobby-list">${members.map(([uid, m]) => `<li class="${m.ready ? 'is-ready' : ''}"><div class="lobby-player"><strong><span class="lobby-player-name">${esc(m.name)}</span>${uid === api.uid ? '<span class="lobby-self-tag">VOS</span>' : ''}</strong><span class="presence-text ${memberOnline(uid) ? 'is-online' : ''}" data-presence="${esc(uid)}">${memberOnline(uid) ? 'Conectado' : 'Reconectando…'}</span></div><span class="lobby-state">${uid === s.room.hostId ? '<em>HOST</em>' : ''}<b>${m.ready ? 'LISTO' : 'NO LISTO'}</b></span></li>`).join('')}</ul><button id="ready-toggle" class="${s.room.members[api.uid].ready ? 'secondary ready-toggle-on' : ''}" ${disabled}>${s.room.members[api.uid].ready ? '✓ Estoy listo' : 'Estoy listo'}</button>${host ? `<button id="start-game" ${disabled || (members.length < 2) || missingReady > 0 || offlineCount > 0 ? 'disabled' : ''}>Iniciar partida</button><p class="muted lobby-help">${members.length < 2 ? 'Esperando al menos a otro jugador.' : offlineCount ? `Esperando que vuelva${offlineCount === 1 ? '' : 'n'} ${offlineCount} jugador${offlineCount === 1 ? '' : 'es'}.` : missingReady ? `Falta${missingReady === 1 ? '' : 'n'} ${missingReady} por marcarse listo.` : 'Todos listos y conectados. Ya podés iniciar.'}</p>` : `<p class="muted lobby-help">${missingReady ? `Esperando a ${missingReady} jugador${missingReady === 1 ? '' : 'es'}.` : 'Todos listos. El host puede iniciar.'}</p>`}<button id="leave-room" class="quiet">Salir de la sala</button></section>`;
  } else if (!s.game) {
    html = `<section class="state"><div class="spinner" aria-hidden="true"></div><h1>${s.gameError ? esc(s.gameError) : 'Cargando la partida…'}</h1><button id="leave-room" class="quiet">Salir de la sala</button><button id="reset-session" class="quiet">Volver al inicio</button></section>`;
  } else {
    const game = s.game;
    const me = game.players[api.uid];
    const terminal = ['finished', 'abandoned'].includes(game.phase);
    const choice = s.choice?.turn === game.turn ? s.choice : accepted();
    const title = terminal ? game.phase === 'abandoned' ? 'Partida abandonada' : game.draw ? '¡Empate! Todos pelados.' : `Ganó ${esc(game.players[game.winnerId]?.name ?? 'un jugador')}` : game.phase === 'countdown' ? 'Preparados' : `Turno ${game.turn}`;
    const seats = game.memberIds || Object.keys(game.players);
    const order = [...seats.filter(uid => uid !== api.uid), api.uid].filter(uid => game.players[uid]);
    const activeCount = Object.values(game.players).filter(player => player.hair > 0).length;
    const chosenCount = Object.keys(game.chosen || {}).filter(uid => game.players[uid]?.hair > 0 && game.chosen[uid]).length;
    const actionHint = s.targeting
      ? 'Elegí un rival · tocá su tarjeta o soltá encima.'
      : me?.breath < 1
        ? 'Sin Soplos · Tomá aire para poder atacar.'
        : 'SOPLAR: arrastrá al rival o tocá y después elegilo.';
    const playControls = game.phase === 'choosing' && me?.hair > 0 ? `<p class="play-hint ${s.targeting ? 'is-targeting' : ''}">${actionHint}</p>${actionControls(canChoose(), me.breath, s.targeting, choice?.action)}<p id="selection" aria-live="polite">${s.targeting ? 'Modo objetivo activo. Tocá SOPLAR de nuevo para cancelar.' : choice ? `${s.choice ? 'Guardando' : 'Elegido'}: ${esc(choiceName(choice))}` : 'Elegí una jugada · si no elegís: Distraído'}</p>` : '';
    const phaseLabel = { countdown:'PREPARADOS', syncing:'SINCRONIZANDO', choosing:'ELEGÍ TU JUGADA', locked:'ACCIONES SELLADAS', reveal:'REVELANDO RESULTADOS', finished:'PARTIDA TERMINADA', abandoned:'PARTIDA CERRADA' }[game.phase] || 'PARTIDA';
    const phaseDetail = game.phase === 'choosing' ? `${chosenCount}/${activeCount} eligieron` : game.phase === 'reveal' ? 'Mirá qué pasó' : game.phase === 'locked' ? 'Resolviendo…' : game.phase === 'countdown' ? 'Todos atentos' : '';
    html = `<section class="game" data-phase="${esc(game.phase)}" data-impact="${roundImpact(game)}" data-targeting="${s.targeting ? 'true' : 'false'}"><div class="phase-banner"><span>${phaseLabel}</span><strong>${phaseDetail}</strong></div><div class="turn-meter" aria-hidden="true"><i></i></div><div class="turn-header"><div><p class="eyebrow">Sala ${esc(s.room.code)}</p><h1>${title}</h1></div>${!terminal ? '<span id="timer" role="timer" aria-label="Tiempo restante"></span>' : ''}</div><p id="turn-status" aria-live="polite">${game.phase === 'countdown' ? 'La partida empieza en…' : game.phase === 'syncing' ? 'Preparando el turno en todos los celulares…' : game.phase === 'locked' ? 'Todos eligieron. Las jugadas están congeladas.' : terminal ? game.phase === 'abandoned' ? 'La partida se cerró por abandono.' : 'La partida terminó. La próxima partida empieza desde cero.' : game.phase === 'reveal' ? 'Resultado del turno' : me?.hair > 0 ? 'Elegí en secreto. Cuando todos eligen, se revela.' : 'Estás Pelado.'}</p><div class="players" data-count="${order.length}">${order.map(uid => playerCard({ uid, player: game.players[uid], index: seats.indexOf(uid), self: uid === api.uid, selected: choice?.target === uid, chosen: game.chosen?.[uid], connected: memberOnline(uid), winner: terminal && game.winnerId === uid, rules: game.rules, effects: playerEffects(game, uid) })).join('')}<div class="desk-doodle" aria-hidden="true">RIVALES<br>pero compis ♡</div></div>${playControls}${game.phase === 'reveal' || terminal ? resultHtml(game) : ''}${terminal ? s.room.hostId === api.uid && game.phase === 'finished' ? `<button id="back-lobby" ${disabled}>Volver al lobby / revancha</button>` : '<p>La sala se cerrará después de un período de inactividad.</p>' : ''}<button id="leave-room" class="quiet">Salir de la partida</button></section>`;
  }
  // Heartbeats and metadata acknowledgements must not detach active controls.
  if (html === renderedHtml) { tick(); return; }
  app.innerHTML = html; renderedHtml = html;
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
    operation(async () => {
      const profile = await call('saveProfile', { name });
      s.profile = { ...s.profile, name: profile.name };
      s.nameConfirmed = true;
      if (s.roomId && s.room?.status === 'lobby') await roomCommand('rename');
    });
  });
  document.getElementById('install-update')?.addEventListener('click', () => void installUpdate());
  document.getElementById('reload-app')?.addEventListener('click', () => location.reload());
  document.getElementById('reset-session')?.addEventListener('click', () => void resetRoomSession());
  document.querySelector('#join-form')?.addEventListener('submit', event => {
    event.preventDefault(); const code = new FormData(event.target).get('code').trim().toUpperCase();
    operation(() => roomCommand('join', { code }));
  });
  document.getElementById('ready-toggle')?.addEventListener('click', () => operation(() => roomCommand('ready', { ready: !s.room.members[api.uid].ready })));
  for (const [id, command] of [['create-room', 'create'], ['start-game', 'start'], ['back-lobby', 'lobby']]) {
    document.getElementById(id)?.addEventListener('click', () => operation(() => roomCommand(command)));
  }
  document.getElementById('leave-room')?.addEventListener('click', leaveRoom);
  document.querySelector('#share-room')?.addEventListener('click', async () => {
    const code = s.room?.code;
    if (!code) return;
    const url = `${location.origin}/?s=${code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Pelao Bolao', text: `Sala ${code}`, url }); message('Sala compartida.'); }
      else { await navigator.clipboard.writeText(url); message('Enlace de sala copiado.'); }
    } catch { message(`Código: ${code}`); }
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => choose(button.dataset.action)));
  document.querySelectorAll('[data-player]').forEach(button => button.addEventListener('click', () => {
    if (s.targeting) choose('blow', button.dataset.player);
  }));
  const blow = document.querySelector('#blow');
  if (!blow) return;
  blow.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    if (!canChoose()) return;
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
  const checkingConnection = s.online && Boolean(lastContact && Date.now() - lastContact > 30000 && s.roomId);
  const connecting = s.online && !api;
  connection.textContent = !s.online ? 'Sin conexión · reconectando al volver la señal' : checkingConnection ? 'Comprobando conexión con el servidor…' : api ? 'Conectado' : 'Conectando…';
  connection.classList.toggle('offline', !s.online);
  connection.classList.toggle('checking', checkingConnection);
  connection.classList.toggle('connecting', connecting);
  if (s.updateRequired) return;
  document.querySelectorAll('[data-presence]').forEach(el => {
    const online = memberOnline(el.dataset.presence);
    el.textContent = online ? 'Conectado' : 'Reconectando…';
    el.classList.toggle('is-online', online);
  });
  document.querySelectorAll('[data-presence-dot]').forEach(el => {
    el.classList.toggle('online', memberOnline(el.dataset.presenceDot));
  });
  if (!s.game || document.hidden) return;
  const game = s.game;
  const deadline = phaseDeadline(game);
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now()) / 1000)) : null;
  const timer = document.querySelector('#timer');
  if (timer) timer.textContent = seconds === null || seconds === 0 || ['syncing', 'locked'].includes(game.phase) ? '···' : `${String(seconds).padStart(2, '0')}s`;
  if (timer) {
    timer.classList.toggle('warning', game.phase === 'choosing' && seconds !== null && seconds <= 5);
    timer.classList.toggle('urgent', game.phase === 'choosing' && seconds !== null && seconds <= 3);
  }
  const board = document.querySelector('.game');
  if (board && game.phase === 'choosing' && Number.isFinite(deadline)) {
    const duration = Number(game.rules?.turnMs) || 1;
    const remaining = Math.max(0, Math.min(duration, deadline - now()));
    board.style.setProperty('--turn-progress', String(remaining / duration));
  }
  if (!acknowledging && Date.now() - lastAck > 1000 && s.nameConfirmed && !document.hidden && s.online && game.protocolVersion === 2
    && ['countdown', 'syncing'].includes(game.phase) && !game.ready?.[api.uid]) {
    acknowledging = true; lastAck = Date.now();
    call('acknowledgeRound', { gameId: s.gameId, turn: game.turn })
      .catch(showError).finally(() => { acknowledging = false; });
  }
  if (s.game.phase === 'choosing' && seconds === 0) {
    const status = document.querySelector('#turn-status');
    if (status) status.textContent = 'Resolviendo el turno…';
    document.querySelectorAll('.controls button').forEach(button => { button.disabled = true; });
  }
  // Only the current host attempts resolution. Firestore rechecks authority atomically.
  const staleAt = millis(game.lastProgressAt || game.phaseStartedAt || game.finishedAt);
  if (!abandoning && staleAt > 0 && now() - staleAt > ABANDON_MS && !['abandoned'].includes(game.phase) && s.online && Date.now() - lastAbandonAttempt > 1500) {
    abandoning = true; lastAbandonAttempt = Date.now();
    const gameId = s.gameId;
    resetRoomSession('La partida venció por inactividad. Podés crear una sala nueva.');
    void call('abandonGame', { gameId }).catch(() => {}).finally(() => { abandoning = false; });
    return;
  }
  // If the authority tab disappeared, an active participant claims host as soon as
  // the short gameplay lease expires instead of waiting for the next heartbeat tick.
  const hostMember = s.room?.members?.[s.room?.hostId];
  if (s.room?.hostId && s.room.hostId !== api?.uid && hostMember
    && now() - hostMember.lastSeenAt > GAME_HOST_LEASE_MS && s.online) void heartbeat();
  const early = game.protocolVersion === 2 && (game.phase === 'locked'
    || game.phase === 'syncing' && allMarked(game, 'ready')
    || game.phase === 'choosing' && allMarked(game, 'chosen'));
  if (!advancing && s.room?.hostId === api?.uid && s.online && ['countdown', 'syncing', 'choosing', 'locked', 'reveal'].includes(game.phase) && (early || now() > deadline + 100) && Date.now() - lastNudge > 350) {
    lastNudge = Date.now(); advancing = true;
    call('advanceGame', { gameId: s.gameId, turn: s.game.turn, phase: s.game.phase })
      .catch(showError).finally(() => { advancing = false; });
  }
}

document.querySelector('.brand')?.addEventListener('click', event => {
  if (!s.roomId) return;
  event.preventDefault();
  message('Salí de la sala para volver al inicio.');
  vibrate(8);
});

window.addEventListener('offline', () => { cancelDrag(); s.online = false; pending = null; s.choice = null; render(); });
const resyncClock = () => { if (api && s.online && !document.hidden) void api.syncClock().then(tick).catch(() => {}); };
window.addEventListener('online', () => { s.online = true; resyncClock(); heartbeat(); void checkVersion(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { resyncClock(); heartbeat(); tick(); void checkVersion(); } });
setInterval(tick, 200);
setInterval(heartbeat, 2000);
setInterval(checkVersion, 60000);
setInterval(resyncClock, 60000);
render();
void checkVersion();
try {
  api = await connect();
  onSnapshot(doc(api.db, 'profiles', api.uid), snap => { s.profile = snap.data() ?? null; s.ready = true; render(); }, error => {
    s.bootError = error.message || 'No pudimos cargar tu perfil.'; s.ready = true; render(); showError(error);
  });
  // A saved server session is not consent to re-enter an old match.
  // Room subscriptions start only after an explicit create/join action.
  // Brief backgrounding keeps the current page and subscriptions intact.
} catch (error) {
  s.bootError = error.message; s.ready = true; render();
  connection.textContent = 'No conectado';
}
