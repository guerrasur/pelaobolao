import './style.css';
import './reveal.css';
import { doc, onSnapshot } from 'firebase/firestore';
import { connect } from './firebase.js';
import { millis, phaseDeadline, allMarked, lobbyReturnSeconds, GAME_HOST_LEASE_MS, ABANDON_MS, CENTER_ITEM_TARGET, HAIR_ITEM_KIND } from './game.js';
import { playerCard, actionControls } from './visuals.js';
import { playCue } from './sound.js';
import { isNewerVersion } from './version.js';
import { dragGuideGeometry, shouldHoldRenderForDrag } from './condor-core.js';
import { revealStage, revealCountdown, revealViewGame } from './reveal.js';
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
let api, roomOff, gameOff, intentOff, heartbeatBusy = false, lastContact = 0, lastHeartbeatAt = 0;
const ACTIVE_HOST_HEARTBEAT_MS = 1800;
const PASSIVE_HEARTBEAT_MS = 9000;
const HOST_TAKEOVER_GRACE_MS = 750;
const HOST_TAKEOVER_RETRY_MS = 1200;
let roomGeneration = 0, gameGeneration = 0, advancing = false, acknowledging = false, abandoning = false, returningLobby = false, lastAck = 0, lastAbandonAttempt = 0, lastLobbyReturnAttempt = 0, lastPhase;
let operationGeneration = 0;
let renderedHtml;
let lastRevealStageKey = null;
let lastRevealCountdown = null;
let pending = null, sending = false, intentGeneration = 0, sendingGeneration = -1, drag = null, suppressClick = false, lastNudge = 0;
let leaveArmedUntil = 0, leaveArmTimer = 0, lastCheckingConnection = false;
const now = () => api?.now() ?? Date.now();
const connectionFresh = () => !s.roomId || !lastContact || Date.now() - lastContact <= 30000;
const setText = (node, value) => {
  if (!node) return false;
  const next = String(value ?? '');
  if (node.textContent === next) return false;
  node.textContent = next;
  return true;
};
const message = text => { setText(notice, text); };
const actionName = action => ({ air: 'Tomar aire', hide: 'Esconderse', blow: 'Soplar', grab: 'Agarrar +1 Pelo', distracted: 'Distraído' }[action] ?? 'Sin elegir');
const centerItemActive = () => s.game?.centerItem?.kind === HAIR_ITEM_KIND;
const freeCenterPickup = () => Number(s.game?.rules?.version ?? 0) >= 3;
const hideLimit = () => Number(s.game?.rules?.maxConsecutiveHides ?? 3);
const isHideLocked = () => Number(s.game?.players?.[api?.uid]?.hideStreak || 0) >= hideLimit();
const targetName = target => target === CENTER_ITEM_TARGET ? '+1 Pelo' : s.game?.players?.[target]?.name ?? 'jugador';
const validBlowTarget = target => target === CENTER_ITEM_TARGET
  ? (!freeCenterPickup() && centerItemActive())
  : Boolean(target && target !== api?.uid && s.game?.players?.[target]?.hair > 0);
const choiceName = choice => choice.action === 'grab'
  ? 'Agarrar +1 Pelo'
  : `${actionName(choice.action)}${choice.target ? ` → ${targetName(choice.target)}` : ''}`;
const memberOnline = uid => { const member = s.room?.members?.[uid]; return Boolean(member && now() - member.lastSeenAt < 25000); };
const orderedLobbyMembers = members => Object.entries(members ?? {}).sort(([uidA, a], [uidB, b]) => {
  const joinedA = millis(a?.joinedAt), joinedB = millis(b?.joinedAt);
  return joinedA - joinedB || uidA.localeCompare(uidB);
});
const roomWins = uid => Math.max(0, Number(s.room?.wins?.[uid] || 0));
const vibrate = pattern => { try { if (!document.hidden && typeof navigator.vibrate === 'function') navigator.vibrate(pattern); } catch {} };
const matchStillRunning = () => s.room?.status === 'playing' && s.game && !['finished', 'abandoned'].includes(s.game.phase);
function leaveMatchButton() {
  const armed = matchStillRunning() && Date.now() < leaveArmedUntil;
  return `<button id="leave-room" class="quiet${armed ? ' leave-armed' : ''}">${armed ? 'Confirmar salida' : 'Salir de la partida'}</button>`;
}
appMeta.textContent = `MVP · v${APP_VERSION}`;

async function checkVersion() {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const latest = (await response.json()).version;
    if (typeof latest === 'string' && isNewerVersion(latest, APP_VERSION)) {
      s.updateRequired = latest;
      intentGeneration += 1;
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
async function boundedCall(promise, ms) {
  if (typeof globalThis.setTimeout !== 'function') return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      const error = new Error('La conexión tardó demasiado.');
      error.code = 'unavailable';
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    globalThis.clearTimeout?.(timer);
  }
}
function showError(error) {
  const code = error.code;
  const friendly = {
    unavailable: 'No hay conexión con el servidor. Reintentá cuando vuelva.',
    'permission-denied': 'No tenés acceso a esa sala. Volvé a entrar con el código.',
  };
  message(friendly[code] || error.message || 'No pudimos completar la operación.');
}
const showInternalError = error => {
  const code = String(error?.code || '');
  if (code.endsWith('unavailable') || code.endsWith('permission-denied')) return;
  showError(error);
};
function clearDragFeedback() {
  document.getElementById('blow-drag-ghost')?.remove();
  document.getElementById('blow-drag-vector')?.remove();
  document.querySelector('.game')?.classList.remove('is-dragging-blow');
  document.querySelectorAll('[data-player],[data-center-item]').forEach(target => {
    target.classList.remove('valid-target', 'drag-target');
  });
}
function updateDragGhost(x, y, targetName = null) {
  let ghost = document.getElementById('blow-drag-ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'blow-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = '<span class="blow-drag-wind"><i></i><i></i><i></i></span><b>SOPLO</b>';
    document.body.append(ghost);
  }
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
  ghost.classList.toggle('is-over-target', Boolean(targetName));
  const label = ghost.querySelector('b');
  if (label) setText(label, targetName ? `→ ${targetName}` : 'SOPLO');
  document.querySelector('.game')?.classList.add('is-dragging-blow');
}
function updateDragVector(x, y, targetNode = null) {
  const source = document.querySelector('.player.self .avatar-wrap') ?? document.querySelector('.player.self');
  const targetRect = targetNode?.getBoundingClientRect?.() ?? null;
  const geometry = dragGuideGeometry(source?.getBoundingClientRect?.(), x, y, targetRect);
  let vector = document.getElementById('blow-drag-vector');
  if (!geometry) {
    vector?.remove();
    return;
  }
  if (!vector) {
    vector = document.createElement('div');
    vector.id = 'blow-drag-vector';
    vector.setAttribute('aria-hidden', 'true');
    vector.innerHTML = '<i></i><i></i><i></i>';
    document.body.append(vector);
  }
  const stopShort = targetRect ? Math.min(targetRect.width, targetRect.height) * .38 : 10;
  vector.style.left = `${geometry.left}px`;
  vector.style.top = `${geometry.top}px`;
  vector.style.width = `${Math.max(18, geometry.length - stopShort)}px`;
  vector.style.transform = `rotate(${geometry.angle}deg)`;
  vector.classList.toggle('is-snapped', Boolean(targetRect));
}
function cancelDrag() {
  const previous = drag;
  drag = null;
  clearDragFeedback();
  const button = document.querySelector('#blow');
  if (previous && button?.hasPointerCapture(previous.pointerId)) button.releasePointerCapture(previous.pointerId);
}
function detachGame() {
  gameGeneration += 1; cancelDrag(); returningLobby = false; lastLobbyReturnAttempt = 0;
  globalThis.clearTimeout?.(leaveArmTimer); leaveArmTimer = 0; leaveArmedUntil = 0;
  gameOff?.(); intentOff?.(); gameOff = null; intentOff = null;
  s.gameId = null; s.game = null; s.intent = null; s.gameError = null;
  intentGeneration += 1;
  s.choice = null; pending = null; s.targeting = false;
}
function resetRoomSession(text = '') {
  const oldRoomId = s.roomId;
  roomGeneration += 1; operationGeneration += 1;
  roomOff?.(); roomOff = null; s.roomId = null; s.room = null; detachGame();
  s.busy = false; s.resetting = false;
  message(text); render();
  // Local navigation never waits for network access or room permissions.
  if (oldRoomId) void call('clearRoomSession', { roomId: oldRoomId }).catch(() => {});
}
function leaveRoom() {
  if (matchStillRunning() && Date.now() >= leaveArmedUntil) {
    leaveArmedUntil = Date.now() + 2600;
    globalThis.clearTimeout?.(leaveArmTimer);
    leaveArmTimer = globalThis.setTimeout?.(() => {
      if (Date.now() < leaveArmedUntil) return;
      leaveArmedUntil = 0; leaveArmTimer = 0;
      message(''); render();
    }, 2700);
    message('Tocá Confirmar salida para abandonar esta partida.');
    render();
    return;
  }
  globalThis.clearTimeout?.(leaveArmTimer); leaveArmTimer = 0; leaveArmedUntil = 0;
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
    lastContact = Date.now();
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
      if (['reveal', 'finished'].includes(s.game.phase)) {
        lastRevealStageKey = null;
        lastRevealCountdown = null;
        if (Number(s.game.rules?.version ?? 0) < 5) playImpactCue(s.game);
      }
      if (s.game.phase === 'abandoned') playCue('end');
    }
    lastPhase = s.game.phase;
    if (oldTurn !== s.game?.turn || s.game?.phase !== 'choosing') {
      intentGeneration += 1;
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
    if (!snap.metadata?.fromCache) lastContact = Date.now();
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
    lastContact = Date.now();
    const room = snap.data();
    if (!room || room.status === 'closed' || !room.members?.[api.uid] || room.members[api.uid].left) {
      void resetRoomSession('Esa sala ya no está disponible. Podés crear otra o volver con un código.');
      return;
    }
    const previousStatus = s.room?.status;
    s.room = { ...room, members: Object.fromEntries(Object.entries(room.members).map(([uid, m]) => [uid, { ...m, lastSeenAt: millis(m.lastSeenAt) }])) };
    if (room.status === 'lobby' && previousStatus && previousStatus !== 'lobby') {
      returningLobby = false; lastLobbyReturnAttempt = 0; message('');
    }
    subscribeGame(room.gameId);
    render();
  }, error => {
    if (generation !== roomGeneration) return;
    showError(error);
    void resetRoomSession('La sesión anterior no se pudo recuperar. Ya podés volver a entrar.');
  });
  void heartbeat(true);
}
async function roomCommand(command, extra = {}) {
  const generation = roomGeneration;
  const result = await call('roomCommand', { command, ...(!['create', 'join'].includes(command) ? { roomId: s.roomId } : {}), ...extra });
  if (result.roomId) lastHeartbeatAt = Date.now();
  if (generation === roomGeneration && command !== 'touch') subscribeRoom(result.roomId);
}
async function heartbeat(force = false) {
  if (!api || !s.roomId || !s.online || document.hidden || s.updateRequired || heartbeatBusy || advancing) return;
  const wallNow = Date.now();
  const activeHost = s.room?.hostId === api.uid && ['playing', 'finished'].includes(s.room?.status);
  const interval = activeHost ? ACTIVE_HOST_HEARTBEAT_MS : PASSIVE_HEARTBEAT_MS;
  if (!force && wallNow - lastHeartbeatAt < interval) return;
  const generation = roomGeneration;
  lastHeartbeatAt = wallNow;
  heartbeatBusy = true;
  try { await boundedCall(roomCommand('touch'), 3200); }
  catch (error) {
    if (generation !== roomGeneration) return;
    if (error.code?.endsWith('not-found')) {
      lastHeartbeatAt = 0;
      showError(error);
      void resetRoomSession('La sala dejó de estar disponible. Ya podés volver a entrar.');
      return;
    }
    if (error.code?.endsWith('permission-denied')) {
      // A takeover can race the server-side 5 s lease by a few milliseconds even
      // with a calibrated clock. Keep the local room and let the authoritative
      // room snapshot decide whether access was actually revoked.
      lastHeartbeatAt = Date.now();
      return;
    }
    lastHeartbeatAt = 0;
  } finally { heartbeatBusy = false; }
}

function canChoose() {
  return s.nameConfirmed && !s.updateRequired && !s.gameError && s.online && connectionFresh() && s.game?.phase === 'choosing'
    && Number.isFinite(phaseDeadline(s.game)) && now() < phaseDeadline(s.game)
    && !(s.game.protocolVersion === 2 && allMarked(s.game, 'chosen')) && s.game.players[api.uid]?.hair > 0;
}
function pendingIntentStillValid(intent) {
  const deadline = phaseDeadline(s.game);
  return Boolean(intent && s.nameConfirmed && !s.updateRequired && !s.gameError
    && intent.gameId === s.gameId && intent.turn === s.game?.turn && s.game?.phase === 'choosing'
    && Number.isFinite(deadline) && now() < deadline && s.game?.players?.[api.uid]?.hair > 0);
}
function accepted() { return s.intent?.turn === s.game?.turn ? s.intent : null; }
function choose(action, target = null) {
  if (s.online && !connectionFresh()) { message('Comprobando conexión con el servidor…'); return; }
  if (!canChoose()) { message('Ya no podés elegir en este turno.'); return; }
  if (action === 'blow' && (s.game.players[api.uid].breath < 1 || !validBlowTarget(target))) return;
  if (action === 'hide' && isHideLocked()) { message(`Solo podés esconderte ${hideLimit()} veces seguidas. Elegí otra acción.`); return; }
  if (action === 'grab' && (!freeCenterPickup() || target !== CENTER_ITEM_TARGET || !centerItemActive())) return;
  const current = s.choice?.turn === s.game.turn ? s.choice : accepted();
  if (current?.action === action && (current.target ?? null) === (target ?? null)) {
    s.targeting = false;
    render();
    return;
  }
  s.targeting = false;
  s.choice = { action, target, turn: s.game.turn };
  vibrate(action === 'blow' ? 16 : action === 'grab' ? [12, 20, 28] : 9);
  pending = { ...s.choice, gameId: s.gameId, requestId: crypto.randomUUID() };
  render(); void flushIntent();
}
async function flushIntent() {
  const generation = intentGeneration;
  if (sending && sendingGeneration === generation) return;
  sending = true; sendingGeneration = generation;
  while (pending && generation === intentGeneration) {
    const next = pending; pending = null;
    if (!canChoose() || next.gameId !== s.gameId || next.turn !== s.game?.turn) {
      if (!s.online && pendingIntentStillValid(next)) {
        pending = next;
        break;
      }
      if (!pending && s.choice?.turn === next.turn) s.choice = null;
      continue;
    }
    try {
      const result = await boundedCall(
        call('submitIntent', { ...next, expectedRevision: accepted()?.revision ?? 0 }),
        3200,
      );
      if (generation !== intentGeneration) break;
      if (next.gameId === s.gameId && next.turn === s.game?.turn) {
        if (!s.intent || s.intent.turn !== result.turn || s.intent.revision <= result.revision) s.intent = result;
        if (!pending) s.choice = null;
        message('');
      }
    } catch (error) {
      if (generation !== intentGeneration) break;
      if (next.gameId === s.gameId && next.turn === s.game?.turn) {
        const transient = String(error.code || '').endsWith('unavailable');
        if (transient && pendingIntentStillValid(next)) {
          pending = pending ?? next;
          message(s.online ? 'Conexión inestable · reintentando…' : 'Sin conexión · la jugada se enviará al volver.');
          if (s.online) window.setTimeout(() => { void flushIntent(); }, 700);
          break;
        }
        if (!pending) s.choice = null;
        showError(error);
      }
    }
    render();
  }
  if (sendingGeneration === generation) {
    sending = false; sendingGeneration = -1; render();
  }
}

function roundImpact(game) {
  const result = game?.lastResult;
  if (!result || !['reveal', 'finished'].includes(game.phase)) return 'none';
  const lost = Object.values(result.losses || {}).some(loss => Number(loss) > 0);
  const healed = Object.values(result.heals || {}).some(heal => Number(heal) > 0);
  if (lost && healed) return 'swing';
  if (lost) return 'hit';
  if ((result.hits || []).some(hit => hit.blocked)) return 'block';
  if (healed) return 'heal';
  if (result.item?.outcome === 'contested') return 'item-clash';
  if (result.item?.outcome === 'claimed') return 'item-claim';
  if (result.item?.outcome === 'expired') return 'item-expire';
  return 'reveal';
}

function playerEffects(game, uid, stage = 'impact') {
  const result = game.lastResult;
  if (!result || !['reveal', 'finished'].includes(game.phase)) return {};
  const action = result.actions?.[uid]?.action;
  if (stage === 'suspense') return {};
  if (stage === 'actions') return { action };
  const incoming = (result.hits || []).filter(hit => hit.to === uid);
  const outgoing = (result.hits || []).find(hit => hit.from === uid);
  const loss = Number(result.losses?.[uid] || 0);
  const healed = Number(result.heals?.[uid] || 0);
  return {
    // Staged reveals already animated the choice in the previous beat.
    // Do not replay the same body/action animation when damage lands.
    action: Number(game.rules?.version ?? 0) >= 5 ? null : action,
    loss,
    healed,
    hit: loss > 0,
    blockedDefense: incoming.some(hit => hit.blocked),
    blockedAttack: outgoing?.blocked === true,
  };
}


function revealOverlayHtml(game, stage) {
  if (!game?.lastResult || !['reveal', 'finished'].includes(game.phase) || Number(game.rules?.version ?? 0) < 5 || stage === 'impact') return '';
  // Keep the markup independent from wall-clock time. tick() owns the visible
  // countdown so harmless room/presence snapshots cannot replace the whole game
  // tree midway through 3 → 2 → 1 and restart the reveal choreography.
  if (stage === 'suspense') {
    return '<div class="round-reveal-overlay suspense" aria-hidden="true"><div><small>JUGADAS SELLADAS</small><strong data-reveal-countdown></strong><span>Nadie puede cambiar ahora</span></div></div>';
  }
  return '<div class="round-reveal-overlay actions" aria-hidden="true"><div><strong>¡JUGADAS!</strong><span>Todos muestran qué hicieron</span></div></div>';
}

function drawRevealAttackLines(game, stage) {
  const layer = document.querySelector('.reveal-attack-lines');
  if (!layer || !['actions', 'impact'].includes(stage) || !game?.lastResult) return;
  layer.innerHTML = '';
  const board = document.querySelector('.players');
  const boardRect = board?.getBoundingClientRect?.();
  if (!boardRect) return;
  const cards = [...document.querySelectorAll('[data-player]')];
  const byId = id => cards.find(node => node.dataset.player === id);
  for (const [uid, action] of Object.entries(game.lastResult.actions || {})) {
    if (action.action !== 'blow' || !action.target || action.target === CENTER_ITEM_TARGET) continue;
    const from = byId(uid)?.querySelector?.('.avatar-wrap') ?? byId(uid);
    const to = byId(action.target)?.querySelector?.('.avatar-wrap') ?? byId(action.target);
    const fromRect = from?.getBoundingClientRect?.();
    const toRect = to?.getBoundingClientRect?.();
    if (!fromRect || !toRect) continue;
    const x1 = fromRect.left + fromRect.width / 2 - boardRect.left;
    const y1 = fromRect.top + fromRect.height / 2 - boardRect.top;
    const x2 = toRect.left + toRect.width / 2 - boardRect.left;
    const y2 = toRect.top + toRect.height / 2 - boardRect.top;
    const dx = x2 - x1, dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance < 24) continue;
    const stopShort = Math.min(48, Math.max(26, toRect.width * .3));
    const line = document.createElement('span');
    line.className = 'reveal-attack-line';
    if ((game.lastResult.hits || []).some(hit => hit.from === uid && hit.to === action.target && hit.blocked)) {
      line.classList.add('is-blocked');
    }
    line.style.left = `${x1}px`;
    line.style.top = `${y1}px`;
    line.style.width = `${Math.max(18, distance - stopShort)}px`;
    line.style.setProperty('--line-rotate', `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`);
    layer.append(line);
  }
}

function playImpactCue(game) {
  const impact = roundImpact(game);
  const cue = {
    hit: 'hit', block: 'block', heal: 'heal', swing: 'swing',
    'item-clash': 'itemClash', 'item-claim': 'itemClaim',
  }[impact] || 'reveal';
  playCue(cue);
  const mine = playerEffects(game, api.uid, 'impact');
  const itemResult = game.lastResult?.item;
  const itemAttempted = itemResult?.attempts?.includes?.(api.uid);
  if (mine.hit && mine.healed) vibrate([42, 22, 20, 22, 38]);
  else if (mine.hit) vibrate([38, 28, 62]);
  else if (mine.healed) vibrate([18, 24, 18]);
  else if (itemResult?.outcome === 'contested' && itemAttempted) vibrate([16, 18, 16]);
  else if (itemResult?.outcome === 'claimed' && itemResult.winnerId === api.uid) vibrate([16, 22, 38]);
  else if (mine.blockedDefense) vibrate([22, 32, 22]);
  else if (mine.blockedAttack) vibrate(18);

  if (game.phase === 'finished') {
    const outcome = outcomeKind(game, api.uid);
    const gameId = s.gameId, turn = game.turn;
    setTimeout(() => {
      if (s.gameId !== gameId || s.game?.turn !== turn || s.game?.phase !== 'finished') return;
      playCue(outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : 'end');
      vibrate(outcome === 'win' ? [24, 35, 24, 35, 70] : outcome === 'lose' ? [70, 32, 95] : 30);
    }, 420);
  }
}

function syncRevealTimeline(game) {
  const staged = Boolean(game?.lastResult) && ['reveal', 'finished'].includes(game.phase)
    && Number(game.rules?.version ?? 0) >= 5;
  if (!staged) {
    lastRevealStageKey = null;
    lastRevealCountdown = null;
    return false;
  }

  const stage = revealStage(game, now());
  const key = `${s.gameId || 'game'}:${game.turn}:${game.phase}:${stage}`;

  if (stage === 'suspense') {
    const value = revealCountdown(game, now());
    const countdown = document.querySelector('[data-reveal-countdown]');
    if (countdown && value !== lastRevealCountdown) {
      lastRevealCountdown = value;
      setText(countdown, value ?? '');
      try {
        countdown.animate?.(
          [{ opacity:.45, transform:'scale(.78)' }, { opacity:1, transform:'scale(1)' }],
          { duration:240, easing:'cubic-bezier(.2,.9,.3,1.18)' }
        );
      } catch {}
      if (value && value < 3) playCue('tick');
    }
  }

  if (key === lastRevealStageKey) return false;
  lastRevealStageKey = key;

  if (stage === 'suspense') {
    lastRevealCountdown = revealCountdown(game, now());
    playCue('lock');
    return false;
  }
  if (stage === 'actions') {
    lastRevealCountdown = null;
    playCue('reveal');
    vibrate(8);
    render();
    return true;
  }

  lastRevealCountdown = null;
  playImpactCue(game);
  render();
  return true;
}

function selectionText(choice) {
  if (s.targeting) return 'Tocá SOPLAR de nuevo para cancelar.';
  if (!choice) return 'Si no elegís a tiempo: Distraído';
  if (s.choice && !s.online) return `Sin conexión · pendiente: ${esc(choiceName(choice))}`;
  if (choice.action === 'blow' && choice.target) {
    const label = esc(targetName(choice.target));
    return s.choice ? `Fijando objetivo: ${label}…` : `OBJETIVO FIJADO: ${label} · SOPLO preparado`;
  }
  if (choice.action === 'grab') {
    return s.choice ? 'Agarrando el mechón…' : 'MECHÓN ELEGIDO · quedás expuesto este turno';
  }
  return `${s.choice ? 'Guardando' : 'Elegido'}: ${esc(choiceName(choice))}`;
}

function sealedChoiceHtml(game, choice, me) {
  if (game?.phase !== 'locked' || !me || me.hair <= 0) return '';
  const label = choice ? choiceName(choice) : 'Distraído';
  return `<div class="sealed-choice" role="status"><b>JUGADA SELLADA</b><span>${esc(label)}</span></div>`;
}

function centerItemHtml(game, choice) {
  const stagedFinalReveal = game.phase === 'finished' && revealStage(game, now()) !== 'impact';
  if (game.centerItem?.kind !== HAIR_ITEM_KIND || !(['choosing', 'locked', 'reveal'].includes(game.phase) || stagedFinalReveal)) return '';
  const freePickup = Number(game.rules?.version ?? 0) >= 3;
  const selectedGrab = freePickup && choice?.action === 'grab' && choice.target === CENTER_ITEM_TARGET;
  const selectedLegacyTarget = !freePickup && choice?.action === 'blow' && choice.target === CENTER_ITEM_TARGET;
  // A free pickup is contextual: while aiming a Soplo the item stops acting like a control.
  const targetable = Boolean(canChoose() && (freePickup ? !s.targeting : s.targeting));
  const itemAgeRounds = Number.isInteger(game.centerItem.spawnedTurn)
    ? Math.max(1, game.turn - game.centerItem.spawnedTurn + 1)
    : 1;
  const isNew = game.phase === 'choosing' && itemAgeRounds === 1;
  const isExpiring = itemAgeRounds >= 3;
  const label = freePickup
    ? `+1 Pelo. Agarrar no cuesta Soplos, pero te deja expuesto.${isExpiring ? ' Última ronda antes de desaparecer.' : ''}`
    : `+1 Pelo, cuesta 1 Soplo.${isExpiring ? ' Última ronda antes de desaparecer.' : ''}`;
  return `<button type="button" class="center-item hair-item ${freePickup ? 'free-pickup' : 'legacy-blow-item'} ${targetable ? 'targetable' : ''} ${selectedGrab ? 'selected-grab' : ''} ${selectedLegacyTarget ? 'selected-target' : ''} ${isNew ? 'is-new' : ''} ${isExpiring ? 'is-expiring' : ''}" data-center-item="${CENTER_ITEM_TARGET}" data-item-turn="${esc(game.centerItem.spawnedTurn)}" data-item-age="${itemAgeRounds}" aria-disabled="${targetable ? 'false' : 'true'}" aria-pressed="${selectedGrab || selectedLegacyTarget ? 'true' : 'false'}" tabindex="${targetable ? '0' : '-1'}" ${targetable ? '' : 'disabled'} aria-label="${label}">
    <i class="hair-tuft" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></i>
  </button>`;
}

function centerItemNotice() {
  // The center pickup is intentionally communicated by the tuft alone.
  // Mechanics and expiry remain available on the interactive tuft's aria-label.
  return '';
}

function outcomeKind(game, uid) {
  if (game?.phase !== 'finished') return null;
  if (!game.players?.[uid]) return 'spectator';
  if (game.draw || !game.winnerId) return 'draw';
  return game.winnerId === uid ? 'win' : 'lose';
}

function endCelebrationHtml(game, uid) {
  const outcome = outcomeKind(game, uid);
  if (!outcome) return '';
  if (outcome === 'spectator') {
    const result = game.draw || !game.winnerId
      ? 'La partida terminó en empate.'
      : `Ganó <b>${esc(game.players?.[game.winnerId]?.name ?? 'un jugador')}</b>.`;
    return `<div class="end-celebration end-spectator" data-outcome="spectator" role="status" aria-live="assertive"><div class="outcome-card"><small>FIN DE LA PARTIDA</small><strong>SE TERMINÓ</strong><span>${result} Entrás en la próxima.</span></div></div>`;
  }
  if (outcome === 'draw') {
    return '<div class="end-celebration end-draw" data-outcome="draw" role="status" aria-live="assertive"><div class="outcome-card"><small>FIN DE LA PARTIDA</small><strong>EMPATE</strong><span>Todos quedaron pelados.</span></div></div>';
  }
  const winnerName = esc(game.players?.[game.winnerId]?.name ?? 'un jugador');
  if (outcome === 'win') {
    const confetti = Array.from({ length: 36 }, (_, index) => {
      const x = (index * 37 + 9) % 100;
      const drift = ((index * 29) % 61) - 30;
      const delay = ((index * 7) % 13) * 0.045;
      const duration = 1.55 + (index % 6) * 0.12;
      const rotation = 160 + (index % 8) * 55;
      return `<i style="--x:${x}%;--drift:${drift}px;--delay:${delay}s;--duration:${duration}s;--rotation:${rotation}deg"></i>`;
    }).join('');
    return `<div class="end-celebration end-win" data-outcome="win" role="status" aria-live="assertive"><div class="confetti" aria-hidden="true">${confetti}</div><div class="outcome-card"><small>ÚLTIMO CON PELO</small><strong>¡GANASTE!</strong></div></div>`;
  }
  const tomatoes = [
    ['18%','38%','-130px','0s','-22deg'],
    ['78%','31%','120px','.12s','18deg'],
    ['35%','58%','-90px','.25s','-15deg'],
    ['67%','62%','105px','.34s','25deg'],
    ['49%','43%','-115px','.46s','-8deg'],
    ['84%','72%','135px','.58s','31deg'],
  ].map(([x,y,sx,delay,rot]) => `<i class="tomato" style="--x:${x};--y:${y};--sx:${sx};--delay:${delay};--rot:${rot}"></i>`).join('');
  return `<div class="end-celebration end-lose" data-outcome="lose" role="status" aria-live="assertive"><div class="tomato-volley" aria-hidden="true">${tomatoes}</div><div class="outcome-card"><small>TE DEJARON PELADO</small><strong>PERDISTE</strong></div><div class="outcome-winner">Ganó <b>${winnerName}</b></div></div>`;
}

function roundCallout(game) {
  const result = game?.lastResult;
  if (!result) return '';
  const blocked = (result.hits || []).filter(hit => hit.blocked).length;
  const hairLost = Object.values(result.losses || {}).reduce((total, loss) => total + Number(loss || 0), 0);
  const hairHealed = Object.values(result.heals || {}).reduce((total, heal) => total + Number(heal || 0), 0);
  if (hairLost > 0 && hairHealed > 0) return 'PELO VA, PELO VIENE';
  if (hairLost >= 2) return 'CAOS EN EL AULA';
  if (blocked > 0 && hairLost === 0) return 'DEFENSA PERFECTA';
  if (hairLost > 0) return 'VOLÓ PELO';
  if (result.item?.outcome === 'claimed' && result.item.healed > 0) return 'PELO RECUPERADO';
  if (result.item?.outcome === 'claimed' && result.item.claimantAlive === false) return 'LLEGÓ TARDE';
  if (result.item?.outcome === 'claimed') return 'SE LO NEGÓ';
  if (result.item?.outcome === 'contested') return 'NADIE SE LO LLEVA';
  if (result.item?.outcome === 'expired') return 'EL MECHÓN SE FUE';
  return 'RONDA TRANQUILA';
}

function resultHtml(game) {
  const result = game.lastResult;
  if (!result) return '<p class="muted">Las acciones se revelan al terminar el turno.</p>';
  const actions = Object.values(result.actions || {});
  const blows = actions.filter(action => action.action === 'blow' && action.target !== CENTER_ITEM_TARGET).length;
  const itemAttempts = actions.filter(action => action.action === 'grab'
    || (action.action === 'blow' && action.target === CENTER_ITEM_TARGET)).length;
  const breaths = actions.filter(action => action.action === 'air').length;
  const hides = actions.filter(action => action.action === 'hide').length;
  const distracted = actions.filter(action => action.action === 'distracted').length;
  const blockedCount = (result.hits || []).filter(hit => hit.blocked).length;
  const hairLost = Object.values(result.losses || {}).reduce((total, loss) => total + Number(loss || 0), 0);
  const hairHealed = Object.values(result.heals || {}).reduce((total, heal) => total + Number(heal || 0), 0);
  const itemResult = result.item;
  const itemSummary = itemResult?.outcome === 'claimed'
    ? `<div class="item-result claimed"><b>+1 PELO</b><span>${esc(game.players[itemResult.winnerId]?.name ?? 'Jugador')}${itemResult.healed > 0 ? ' recuperó 1 Pelo' : itemResult.claimantAlive === false ? ' quedó Pelado antes de curarse' : ' ya estaba al máximo'}</span></div>`
    : itemResult?.outcome === 'contested'
      ? `<div class="item-result contested"><b>OBJETO DISPUTADO</b><span>${itemResult.attempts.length} fueron por él · nadie se lo llevó</span></div>`
      : itemResult?.outcome === 'stayed'
        ? '<div class="item-result stayed"><b>+1 PELO SIGUE AHÍ</b><span>Nadie intentó llevárselo</span></div>'
        : itemResult?.outcome === 'expired'
          ? '<div class="item-result stayed expired"><b>EL MECHÓN DESAPARECIÓ</b><span>Nadie lo agarró en tres rondas</span></div>'
          : '';
  return `<section class="result" aria-label="Resultado actual">
    <div class="result-callout">${roundCallout(game)}</div>
    ${itemSummary}
    <div class="result-head"><h2>Turno ${esc(result.turn)}</h2><div class="result-summary" aria-label="Resumen del turno">
      ${blows ? `<span data-kind="blow"><b>ATAQUE</b> ${blows}</span>` : ''}
      ${itemAttempts ? `<span class="item-chip" data-kind="item"><b>MECHÓN</b> ${itemAttempts}</span>` : ''}
      ${breaths ? `<span data-kind="air"><b>AIRE</b> ${breaths}</span>` : ''}
      ${hides ? `<span data-kind="hide"><b>ABAJO</b> ${hides}</span>` : ''}
      ${distracted ? `<span data-kind="distracted"><b>DISTRAÍDO</b> ${distracted}</span>` : ''}
      ${blockedCount ? `<span data-kind="block"><b>BLOQ.</b> ${blockedCount}</span>` : ''}
      ${hairLost ? `<span class="danger" data-kind="damage"><b>PELO</b> −${hairLost}</span>` : '<span data-kind="safe"><b>PELO</b> SIN DAÑO</span>'}
      ${hairHealed ? `<span class="heal" data-kind="heal"><b>PELO</b> +${hairHealed}</span>` : ''}
    </div></div>
    <ul>${Object.entries(result.actions).map(([uid, action]) => {
      const playerName = esc(game.players[uid]?.name ?? 'Jugador');
      const target = action.action === 'grab' ? '' : action.target ? ` → ${esc(action.target === CENTER_ITEM_TARGET ? '+1 Pelo' : game.players[action.target]?.name ?? 'jugador')}` : '';
      const lossValue = Number(result.losses?.[uid] || 0);
      const healValue = Number(result.heals?.[uid] || 0);
      const loss = lossValue ? ` · perdió ${lossValue} Pelo` : '';
      const heal = healValue ? ` · recuperó ${healValue} Pelo` : '';
      const blocked = (result.hits || []).find(hit => hit.from === uid)?.blocked ? ' · soplo bloqueado' : '';
      return `<li data-result-action="${esc(action.action)}" class="${lossValue ? 'result-damaged' : ''} ${healValue ? 'result-healed' : ''}"><strong>${playerName}</strong><span>${actionName(action.action)}${target}${blocked}${loss}${heal}</span></li>`;
    }).join('')}</ul>
  </section>`;
}

function render() {
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
    html = '<section class="state entry-screen entry-loading"><div class="entry-loader" aria-hidden="true"><i></i><i></i><i></i><b></b></div><h1>Cargando…</h1><button id="reload-app" class="quiet">Reintentar</button></section>';
  } else if (!s.nameConfirmed) {
    html = `<section class="entry-screen profile-screen"><div class="profile-heading"><div class="profile-doodle" aria-hidden="true"><i></i><b></b><b></b><b></b></div><h1>¿Cuál es tu nombre?</h1><div class="profile-map" aria-hidden="true"><b></b></div></div><form id="profile-form" class="entry-form"><label for="player-name">Nombre</label><input id="player-name" name="name" maxlength="24" required autocomplete="nickname" placeholder="Tu nombre" value="${esc(s.profile?.name ?? '')}"><button ${disabled}><span>Continuar</span></button></form></section>`;
  } else if (!s.roomId) {
    const joinCode = new URLSearchParams(location.search).get('s') ?? '';
    html = `<section class="entry-screen home-screen"><div class="home-hero"><div class="home-title-mark" aria-label="Pelao Bolao. No te quedes pelao"><strong>PELAO</strong><strong>BOLAO</strong><span>No te quedes pelao</span></div><figure class="home-artwork" aria-hidden="true"><img src="/assets/menu-pelao-bolao.webp" alt="" width="420" height="271" decoding="async" fetchpriority="high"></figure></div><div class="home-actions"><button id="create-room" class="home-create" ${disabled}><span>CREAR SALA</span></button><form id="join-form" class="join-card"><div class="join-heading"><label for="room-code">Entrar con código</label></div><div class="join-row"><input id="room-code" name="code" maxlength="4" minlength="4" pattern="[A-Za-z2-9]{4}" value="${esc(joinCode)}" placeholder="AB7K" autocapitalize="characters" autocomplete="off" spellcheck="false" required aria-label="Código de sala"><button class="secondary" ${disabled}><span>ENTRAR</span></button></div></form></div></section>`;
  } else if (!s.room) {
    html = '<section class="state entry-screen room-loading"><div class="entry-loader door-loader" aria-hidden="true"><i></i><i></i><i></i><b></b></div><h1>Entrando…</h1><button id="reset-session" class="quiet">Volver</button></section>';
  } else if (s.room.status === 'lobby') {
    const members = orderedLobbyMembers(s.room.members);
    const host = s.room.hostId === api.uid;
    const readyCount = members.filter(([, member]) => member.ready).length;
    const onlineCount = members.filter(([uid]) => memberOnline(uid)).length;
    const missingReady = Math.max(0, members.length - readyCount);
    const offlineCount = Math.max(0, members.length - onlineCount);
    const readyRatio = members.length ? readyCount / members.length : 0;
    const showWins = Number(s.room.matchCount || 0) > 0;
    html = `<section class="lobby-screen"><div class="lobby-heading"><div><h1><span class="lobby-room-label">SALA</span><span class="code">${esc(s.room.code)}</span></h1></div><button id="share-room" class="secondary compact-button">Compartir</button></div><div class="ready-progress" style="--ready:${readyRatio}"><div aria-hidden="true"><i></i></div><span>${readyCount}/${members.length} listos · ${onlineCount} conectados</span></div><ul class="lobby-list">${members.map(([uid, m], index) => `<li class="${[m.ready ? 'is-ready' : '', memberOnline(uid) ? '' : 'is-offline'].filter(Boolean).join(' ')}" data-member="${esc(uid)}" data-ready="${m.ready ? 'true' : 'false'}"><div class="lobby-player"><strong><span class="lobby-slot" aria-hidden="true">${index + 1}</span><span class="lobby-player-name">${esc(m.name)}</span>${uid === api.uid ? '<span class="lobby-self-tag">VOS</span>' : ''}</strong><span class="lobby-player-meta"><span class="presence-text ${memberOnline(uid) ? 'is-online' : ''}" data-presence="${esc(uid)}">${memberOnline(uid) ? 'Conectado' : 'Reconectando…'}</span>${showWins ? `<span class="lobby-win-count" data-wins="${roomWins(uid)}" aria-label="${roomWins(uid)} ${roomWins(uid) === 1 ? 'victoria' : 'victorias'} en esta sala"><i aria-hidden="true">★</i><b>${roomWins(uid)}</b><small>VICT.</small></span>` : ''}</span></div><span class="lobby-state">${uid === s.room.hostId ? '<em>HOST</em>' : ''}<b>${m.ready ? 'LISTO' : 'NO LISTO'}</b></span></li>`).join('')}</ul><button id="ready-toggle" class="${s.room.members[api.uid].ready ? 'secondary ready-toggle-on' : ''}" ${disabled}>${s.room.members[api.uid].ready ? '✓ Estoy listo' : 'Estoy listo'}</button>${host ? `<button id="start-game" ${disabled || (members.length < 2) || missingReady > 0 || offlineCount > 0 ? 'disabled' : ''}>Iniciar partida</button>` : ''}<button id="leave-room" class="quiet">Salir</button></section>`;
  } else if (!s.game) {
    html = `<section class="state"><div class="spinner" aria-hidden="true"></div><h1>${s.gameError ? esc(s.gameError) : 'Cargando la partida…'}</h1><button id="leave-room" class="quiet">Salir de la sala</button><button id="reset-session" class="quiet">Volver al inicio</button></section>`;
  } else {
    const game = s.game;
    const revealStep = revealStage(game, now());
    const viewGame = revealViewGame(game, revealStep);
    const finalRevealPending = game.phase === 'finished' && revealStep !== 'impact';
    const me = viewGame.players?.[api.uid];
    const lateSpectator = !me && !(game.memberIds || []).includes(api.uid);
    const terminal = ['finished', 'abandoned'].includes(game.phase);
    const choice = s.choice?.turn === game.turn ? s.choice : accepted();
    const choiceSaving = Boolean(s.choice?.turn === game.turn);
    const outcome = terminal && game.phase === 'finished' && !finalRevealPending ? outcomeKind(game, api.uid) : null;
    const title = finalRevealPending ? `Turno ${game.turn}` : terminal ? game.phase === 'abandoned' ? 'Partida abandonada' : 'Fin de la partida' : game.phase === 'countdown' ? 'Preparados' : `Turno ${game.turn}`;
    const seats = game.memberIds || Object.keys(game.players);
    const order = [...seats.filter(uid => uid !== api.uid), api.uid].filter(uid => game.players[uid]);
    const activeCount = Object.values(viewGame.players || {}).filter(player => player.hair > 0).length;
    const chosenCount = Object.keys(game.chosen || {}).filter(uid => game.players[uid]?.hair > 0 && game.chosen[uid]).length;
    const waitingMembers = orderedLobbyMembers(s.room.members).filter(([uid, member]) => !member.left && !seats.includes(uid));
    const waitingIds = waitingMembers.map(([uid]) => uid);
    const waitingPosition = waitingIds.indexOf(api.uid);
    const waitingNames = waitingMembers.slice(0, 2).map(([, member]) => member.name);
    const waitingSummary = waitingNames.join(', ') + (waitingMembers.length > 2 ? ` +${waitingMembers.length - 2}` : '');
    const waitingTitle = waitingMembers.map(([, member]) => member.name).join(', ');
    const nextMatchQueue = waitingMembers.length
      ? `<div class="next-match-queue" data-waiting-ids="${esc(waitingIds.join(','))}" title="Esperan la próxima: ${esc(waitingTitle)}"><b>PRÓXIMA</b><span>${esc(waitingSummary)}</span></div>`
      : '';
    const spectating = !terminal && (lateSpectator || me?.hair <= 0);
    const spectatorStrip = lateSpectator && !terminal
      ? `<div class="spectator-strip is-waiting"><strong>ESPECTADOR · PRÓXIMA PARTIDA</strong><span>${waitingPosition >= 0 ? `Lugar ${waitingPosition + 1} de ${waitingMembers.length} · ` : ''}Entrás cuando vuelvan al lobby</span></div>`
      : spectating ? `<div class="spectator-strip"><strong>PELADO · MIRANDO</strong><span>${activeCount} siguen con Pelo</span></div>` : '';
    const hideBlocked = Number(me?.hideStreak || 0) >= Number(game.rules?.maxConsecutiveHides ?? 3);
    const actionPrompt = s.targeting ? '¡APUNTÁ!' : centerItemActive() && freeCenterPickup() ? '¡MECHÓN!' : me?.breath < 1 ? '¡TOMÁ AIRE!' : '¡ELEGÍ!';
    const baseActionHint = s.targeting
      ? centerItemActive() && !freeCenterPickup() ? 'Tocá un rival o el +1 Pelo del centro.' : 'Tocá un rival o soltá el Soplo encima.'
      : centerItemActive() && freeCenterPickup()
        ? 'Tocá el mechón para intentar +1 Pelo gratis; al hacerlo quedás expuesto.'
        : me?.breath < 1
          ? centerItemActive() ? 'No tenés Soplos para atacar; el objeto de esta partida usa la regla anterior.' : 'No tenés Soplos para atacar.'
          : centerItemActive() ? 'Podés atacar a un rival o disputar el +1 Pelo.' : 'Soplá, tomá aire o escondete.';
    const actionHint = hideBlocked && !s.targeting
      ? `${baseActionHint} · Esconderse bloqueado: ya van 3 seguidas.`
      : baseActionHint;
    const playControls = game.phase === 'choosing' && me?.hair > 0 ? `<div class="play-hint ${s.targeting ? 'is-targeting' : ''}"><strong>${actionPrompt}</strong><span>${actionHint}</span></div>${actionControls(canChoose(), me.breath, s.targeting, choice?.action, hideBlocked, choiceSaving)}<p id="selection" aria-live="polite">${selectionText(choice)}</p>` : '';
    const stagedReveal = ['reveal', 'finished'].includes(game.phase) && Number(game.rules?.version ?? 0) >= 5;
    const phaseLabel = stagedReveal
      ? revealStep === 'suspense' ? 'JUGADAS SELLADAS' : revealStep === 'actions' ? '¡JUGADAS!' : game.phase === 'finished' ? 'PARTIDA TERMINADA' : 'RESULTADO'
      : ({ countdown:'PREPARADOS', syncing:'SINCRONIZANDO', choosing:'ELEGÍ TU JUGADA', locked:'ACCIONES SELLADAS', reveal:'REVELANDO RESULTADOS', finished:'PARTIDA TERMINADA', abandoned:'PARTIDA CERRADA' }[game.phase] || 'PARTIDA');
    const phaseDetail = game.phase === 'choosing' ? `${chosenCount}/${activeCount} eligieron` : stagedReveal ? revealStep === 'suspense' ? '3 · 2 · 1' : revealStep === 'actions' ? 'Todos muestran su jugada' : 'Ahora, las consecuencias' : game.phase === 'reveal' ? 'Mirá qué pasó' : game.phase === 'locked' ? 'Resolviendo…' : game.phase === 'countdown' ? 'Todos atentos' : '';
    const countdownSplash = game.phase === 'countdown' ? '<div class="countdown-splash" aria-hidden="true"><strong data-countdown-splash>3</strong><span>¡PREPARATE!</span></div>' : '';
    const revealOverlay = revealOverlayHtml(game, revealStep);
    const lobbyReturn = game.phase === 'finished' ? '<div class="lobby-return-countdown" data-lobby-return hidden aria-live="polite"></div>' : '';
    const centerItem = centerItemHtml(viewGame, choice);
    const itemNotice = centerItemNotice(viewGame, viewGame.players?.[api.uid] ?? me);
    const showResult = game.phase === 'abandoned' || (['reveal', 'finished'].includes(game.phase) && revealStep === 'impact');
    const turnStatus = stagedReveal && revealStep === 'suspense'
      ? 'Jugadas selladas. Nadie puede cambiar su acción.'
      : stagedReveal && revealStep === 'actions'
        ? 'Todos muestran su jugada al mismo tiempo.'
        : game.phase === 'countdown' ? 'La partida empieza en…'
          : game.phase === 'syncing' ? 'Preparando el turno en todos los celulares…'
            : game.phase === 'locked' ? 'Todos eligieron. Las jugadas están congeladas.'
              : terminal ? game.phase === 'abandoned' ? 'La partida se cerró por abandono.' : 'La partida terminó. La próxima partida empieza desde cero.'
                : game.phase === 'reveal' ? 'Resultado del turno'
                  : lateSpectator ? 'Estás mirando esta partida. Entrás en la próxima cuando vuelvan al lobby.'
                    : me?.hair > 0 ? 'Elegí en secreto. Cuando todos eligen, se revela.' : 'Estás Pelado.';
    html = `<section class="game ${outcome ? `outcome-${outcome}` : ''}" data-phase="${esc(game.phase)}" data-impact="${revealStep === 'impact' ? roundImpact(game) : 'none'}" data-reveal-stage="${esc(revealStep)}" data-targeting="${s.targeting ? 'true' : 'false'}">${countdownSplash}${revealOverlay}${revealStep === 'impact' ? endCelebrationHtml(game, api.uid) : ''}${lobbyReturn}<div class="phase-banner"><span>${phaseLabel}</span><strong>${phaseDetail}</strong></div><div class="turn-meter" aria-hidden="true"><i></i></div><div class="turn-header"><div><p class="eyebrow">Sala ${esc(s.room.code)}</p><h1>${title}</h1></div><div class="turn-tools">${nextMatchQueue}${game.phase === 'choosing' ? '<span id="timer" role="timer" aria-label="Tiempo restante"></span>' : ''}</div></div><p id="turn-status" aria-live="polite">${esc(turnStatus)}</p>${itemNotice}<div class="players ${centerItem ? 'has-center-item' : ''}" data-count="${order.length}">${order.map(uid => playerCard({ uid, player: viewGame.players[uid], index: seats.indexOf(uid), self: uid === api.uid, selected: choice?.target === uid, chosen: game.chosen?.[uid], connected: memberOnline(uid), winner: Boolean(outcome) && game.winnerId === uid, targetable: Boolean(s.targeting && canChoose() && uid !== api.uid && game.players[uid]?.hair > 0), rules: game.rules, effects: playerEffects(game, uid, revealStep) })).join('')}${centerItem}${revealStep === 'actions' && ['reveal','finished'].includes(game.phase) ? '<div class="reveal-attack-lines" aria-hidden="true"></div>' : ''}<div class="desk-doodle" aria-hidden="true">RIVALES<br>pero compis ♡</div></div>${spectatorStrip}${sealedChoiceHtml(game, choice, me)}${playControls}${showResult ? resultHtml(game) : ''}${terminal ? game.phase === 'abandoned' ? '<p>La sala se cerrará después de un período de inactividad.</p>' : '' : ''}${leaveMatchButton()}</section>`;
  }
  // Heartbeats and metadata acknowledgements must not detach active controls.
  if (html === renderedHtml) { tick(); return; }
  // Keep pointer capture stable while a live blow drag is in progress. Room
  // heartbeats/presence snapshots may request a render, but the timer and
  // connection HUD continue updating through tick().
  if (shouldHoldRenderForDrag(Boolean(drag), s.game?.phase, Boolean(s.updateRequired))) { tick(); return; }
  // Critical state changes (phase/update gate) must tear down transient drag
  // overlays before replacing the captured button.
  if (drag) cancelDrag();
  app.innerHTML = html; renderedHtml = html;
  if (focusId) {
    const replacement = document.getElementById(focusId);
    if (replacement && !replacement.disabled) {
      replacement.focus({ preventScroll: true });
      if (inputValue !== null) { replacement.value = inputValue; replacement.setSelectionRange(...selection); }
    }
  }
  bind();
  if (s.game && revealStage(s.game, now()) === 'actions') drawRevealAttackLines(s.game, 'actions');
  tick();
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
  const consumeSuppressedClick = () => {
    if (!suppressClick) return false;
    suppressClick = false;
    return true;
  };
  document.querySelectorAll('[data-player]').forEach(button => button.addEventListener('click', () => {
    if (consumeSuppressedClick()) return;
    if (s.targeting) choose('blow', button.dataset.player);
  }));
  document.querySelector('[data-center-item]')?.addEventListener('click', event => {
    if (consumeSuppressedClick()) return;
    const target = event.currentTarget.dataset.centerItem;
    if (freeCenterPickup() && !s.targeting) choose('grab', target);
    else if (!freeCenterPickup() && s.targeting) choose('blow', target);
  });
  const blow = document.querySelector('#blow');
  if (!blow) return;
  blow.addEventListener('click', () => {
    if (consumeSuppressedClick()) return;
    if (!canChoose()) return;
    s.targeting = !s.targeting; render();
  });
  blow.addEventListener('pointerdown', event => {
    if (drag || !canChoose() || event.button !== 0 || event.isPrimary === false) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, target: null,
      gameId: s.gameId, turn: s.game.turn };
    blow.setPointerCapture(event.pointerId);
  });
  blow.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
    if (!drag.moved) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-player],[data-center-item]');
    const targetId = target?.dataset.player ?? target?.dataset.centerItem ?? null;
    const previousTarget = drag.target;
    drag.target = validBlowTarget(targetId) ? targetId : null;
    if (drag.target && drag.target !== previousTarget) vibrate(8);
    updateDragGhost(event.clientX, event.clientY, drag.target ? targetName(drag.target) : null);
    document.querySelectorAll('[data-player],[data-center-item]').forEach(node => {
      const id = node.dataset.player ?? node.dataset.centerItem;
      const valid = validBlowTarget(id);
      node.classList.toggle('valid-target', valid);
      node.classList.toggle('drag-target', id === drag.target);
    });
    updateDragVector(event.clientX, event.clientY, drag.target ? target : null);
    setText(document.querySelector('#selection'), drag.target ? `Soltá para soplar a ${targetName(drag.target)}` : freeCenterPickup() ? 'Arrastrá sobre un rival.' : 'Arrastrá sobre un rival o el objeto del centro.');
  });
  const finish = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const previous = drag; drag = null; clearDragFeedback();
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
  const checkingConnection = s.online && Boolean(s.roomId && !connectionFresh());
  const connecting = s.online && !api;
  setText(connection, !s.online ? 'Sin conexión · reconectando al volver la señal' : checkingConnection ? 'Comprobando conexión con el servidor…' : api ? 'Conectado' : 'Conectando…');
  connection.classList.toggle('offline', !s.online);
  connection.classList.toggle('checking', checkingConnection);
  connection.classList.toggle('connecting', connecting);
  if (!checkingConnection && notice.textContent === 'Comprobando conexión con el servidor…') message('');
  if (s.game && checkingConnection !== lastCheckingConnection) {
    lastCheckingConnection = checkingConnection;
    if (checkingConnection) { cancelDrag(); s.targeting = false; }
    render();
    return;
  }
  lastCheckingConnection = checkingConnection;
  if (s.updateRequired) return;
  document.querySelectorAll('[data-presence]').forEach(el => {
    const online = memberOnline(el.dataset.presence);
    setText(el, online ? 'Conectado' : 'Reconectando…');
    el.classList.toggle('is-online', online);
  });
  document.querySelectorAll('[data-presence-dot]').forEach(el => {
    el.classList.toggle('online', memberOnline(el.dataset.presenceDot));
  });
  if (!s.game || document.hidden) return;
  const game = s.game;
  if (syncRevealTimeline(game)) return;
  const returnSeconds = lobbyReturnSeconds(game, now());
  const lobbyReturn = document.querySelector('[data-lobby-return]');
  if (lobbyReturn) {
    lobbyReturn.hidden = returnSeconds === null;
    if (returnSeconds !== null) setText(lobbyReturn, returnSeconds > 0
      ? `Regresando al lobby en ${returnSeconds}s`
      : 'Regresando al lobby…');
  }
  if (game.phase === 'finished' && returnSeconds === 0 && !returningLobby && s.room?.hostId === api?.uid
    && s.online && Date.now() - lastLobbyReturnAttempt > 1500) {
    returningLobby = true; lastLobbyReturnAttempt = Date.now();
    boundedCall(roomCommand('lobby'), 3500).catch(showInternalError).finally(() => { returningLobby = false; });
  }
  const deadline = phaseDeadline(game);
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now()) / 1000)) : null;
  const timer = document.querySelector('#timer');
  if (timer) setText(timer, seconds === null || seconds === 0 || ['syncing', 'locked'].includes(game.phase) ? '···' : `${String(seconds).padStart(2, '0')}s`);
  const countdownSplash = document.querySelector('[data-countdown-splash]');
  if (countdownSplash) setText(countdownSplash, seconds === null ? '' : seconds <= 0 ? '¡YA!' : String(seconds));
  if (timer) {
    timer.classList.toggle('warning', game.phase === 'choosing' && seconds !== null && seconds <= 5);
    timer.classList.toggle('urgent', game.phase === 'choosing' && seconds !== null && seconds <= 3);
  }
  const board = document.querySelector('.game');
  board?.classList.toggle('connection-stale', checkingConnection);
  if (board && game.phase === 'choosing' && Number.isFinite(deadline)) {
    const duration = Number(game.rules?.turnMs) || 1;
    const remaining = Math.max(0, Math.min(duration, deadline - now()));
    board.style.setProperty('--turn-progress', String(remaining / duration));
  }
  if (!acknowledging && Date.now() - lastAck > 1000 && s.nameConfirmed && !document.hidden && s.online && game.protocolVersion === 2
    && game.memberIds?.includes(api.uid) && ['countdown', 'syncing'].includes(game.phase) && !game.ready?.[api.uid]) {
    acknowledging = true; lastAck = Date.now();
    boundedCall(call('acknowledgeRound', { gameId: s.gameId, turn: game.turn }), 3200)
      .catch(showInternalError).finally(() => { acknowledging = false; });
  }
  if (s.game.phase === 'choosing' && seconds === 0) {
    const status = document.querySelector('#turn-status');
    if (status) setText(status, 'Resolviendo el turno…');
    document.querySelectorAll('.controls button').forEach(button => { button.disabled = true; });
  }
  // Only the current host attempts resolution. Firestore rechecks authority atomically.
  const staleAt = millis(game.lastProgressAt || game.phaseStartedAt || game.finishedAt);
  if (!abandoning && staleAt > 0 && now() - staleAt > ABANDON_MS && !['abandoned'].includes(game.phase) && s.online && Date.now() - lastAbandonAttempt > 1500) {
    lastAbandonAttempt = Date.now();
    if (!game.memberIds?.includes(api.uid)) {
      resetRoomSession('La partida que estabas mirando venció por inactividad. Podés volver a entrar a otra sala.');
      return;
    }
    abandoning = true;
    const gameId = s.gameId;
    resetRoomSession('La partida venció por inactividad. Podés crear una sala nueva.');
    void boundedCall(call('abandonGame', { gameId }), 4000).catch(() => {}).finally(() => { abandoning = false; });
    return;
  }
  // If the authority tab disappeared, an active participant claims host as soon as
  // the short gameplay lease expires instead of waiting for the next heartbeat tick.
  const hostMember = s.room?.members?.[s.room?.hostId];
  if (s.room?.hostId && s.room.hostId !== api?.uid && hostMember
    && now() - hostMember.lastSeenAt > GAME_HOST_LEASE_MS + HOST_TAKEOVER_GRACE_MS
    && Date.now() - lastHeartbeatAt > HOST_TAKEOVER_RETRY_MS && s.online) void heartbeat(true);
  const early = game.protocolVersion === 2 && (game.phase === 'locked'
    || game.phase === 'syncing' && allMarked(game, 'ready')
    || game.phase === 'choosing' && allMarked(game, 'chosen'));
  if (!advancing && s.room?.hostId === api?.uid && s.online && ['countdown', 'syncing', 'choosing', 'locked', 'reveal'].includes(game.phase) && (early || now() > deadline + 100) && Date.now() - lastNudge > 350) {
    lastNudge = Date.now(); advancing = true;
    boundedCall(call('advanceGame', { gameId: s.gameId, turn: s.game.turn, phase: s.game.phase }), 4000)
      .catch(showInternalError).finally(() => { advancing = false; });
  }
}

document.querySelector('.brand')?.addEventListener('click', event => {
  if (!s.roomId) return;
  event.preventDefault();
  message('Salí de la sala para volver al inicio.');
  vibrate(8);
});

window.addEventListener('offline', () => { cancelDrag(); s.targeting = false; s.online = false; render(); });
const resyncClock = () => { if (api && s.online && !document.hidden) void api.syncClock().then(tick).catch(() => {}); };
window.addEventListener('online', () => {
  s.online = true; resyncClock(); void heartbeat(true); void checkVersion(); render(); void flushIntent();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelDrag();
    if (s.targeting) { s.targeting = false; render(); }
    return;
  }
  resyncClock(); void heartbeat(true); tick(); void checkVersion(); void flushIntent();
});
window.addEventListener('pagehide', () => {
  cancelDrag();
  s.targeting = false;
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  s.online = navigator.onLine;
  resyncClock(); void heartbeat(true); void checkVersion(); render(); void flushIntent();
});
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
