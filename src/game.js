// Rules executed by the current room host. A match snapshots these rules, so later edits affect new games only.
export const RULES = Object.freeze({
  version: 1, initialHair: 3, maxHair: 4, initialBreath: 0, maxBreath: 2,
  minPlayers: 2, maxPlayers: 6, turnMs: 8000, revealMs: 2500,
  countdownMs: 3000,
});
export const LOBBY_LEASE_MS = 45000;
export const GAME_HOST_LEASE_MS = 5000;
export const ABANDON_MS = 120000;
export const SYNC_WAIT_MS = 5000;
export const END_LOBBY_DELAY_MS = 3000;
export const END_LOBBY_COUNTDOWN_SECONDS = 5;
export const AUTO_LOBBY_MS = END_LOBBY_DELAY_MS + END_LOBBY_COUNTDOWN_SECONDS * 1000;

// All screens derive their timer from the same server-authored timestamp.
export function phaseDeadline(game) {
  const started = millis(game.phaseStartedAt);
  if (game.protocolVersion === 2 && started) {
    const duration = { countdown: game.rules.countdownMs, syncing: SYNC_WAIT_MS,
      choosing: game.rules.turnMs, reveal: game.rules.revealMs, locked: 0 }[game.phase];
    if (duration !== undefined) return started + duration;
  }
  const legacy = game.phase === 'countdown' ? game.countdownEndsAt : game.phase === 'reveal' ? game.nextTurnAt : game.deadline;
  const normalized = millis(legacy);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}
export const allMarked = (game, field) => game.memberIds.every(uid =>
  game.players[uid].hair <= 0 || game[field]?.[uid] === true);

export function lobbyReturnSeconds(game, currentTime) {
  if (game?.phase !== 'finished') return null;
  const finishedAt = millis(game.finishedAt);
  if (!Number.isFinite(finishedAt) || finishedAt <= 0 || !Number.isFinite(currentTime)) return null;
  const elapsed = Math.max(0, currentTime - finishedAt);
  if (elapsed < END_LOBBY_DELAY_MS) return null;
  return Math.max(0, Math.ceil((AUTO_LOBBY_MS - elapsed) / 1000));
}

export class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireThat(condition, message, code = 'failed-precondition') {
  if (!condition) throw new GameError(code, message);
}
export function exactObject(value, keys) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key)), 'Datos inválidos.', 'invalid-argument');
}
export function validId(value) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'Identificador inválido.', 'invalid-argument');
  return value;
}
export function validateIntent(game, uid, intent, now) {
  requireThat(game.phase === 'choosing' && intent.turn === game.turn, 'Ese turno ya terminó.');
  requireThat(now < phaseDeadline(game), 'La acción llegó fuera de tiempo.', 'deadline-exceeded');
  requireThat(game.players[uid]?.hair > 0, 'Estás pelado o no participás.');
  requireThat(['air', 'hide', 'blow'].includes(intent.action), 'Acción inválida.', 'invalid-argument');
  if (intent.action === 'blow') {
    requireThat(game.players[uid].breath >= 1, 'Necesitás un Soplo.');
    requireThat(intent.target !== uid && game.players[intent.target]?.hair > 0, 'Elegí otro jugador activo.');
  } else {
    requireThat(intent.target === null, 'Esta acción no tiene objetivo.', 'invalid-argument');
  }
}

export function newGame(roomId, members, now, rules = RULES) {
  const ids = Object.keys(members).sort((a, b) => members[a].joinedAt - members[b].joinedAt || a.localeCompare(b));
  requireThat(ids.length >= rules.minPlayers && ids.length <= rules.maxPlayers, 'Se necesitan entre 2 y 6 jugadores.');
  return {
    schemaVersion: 3, protocolVersion: 2, ready: {}, chosen: {}, resolvedTurn: 0, roomId, memberIds: ids, rules: { ...rules },
    players: Object.fromEntries(ids.map(uid => [uid, {
      name: members[uid].name, hair: rules.initialHair, breath: rules.initialBreath,
    }])),
    phase: 'countdown', turn: 1, countdownEndsAt: now + rules.countdownMs, deadline: now + rules.countdownMs + rules.turnMs,
    nextTurnAt: null, lastResult: null, winnerId: null, draw: false, createdAt: now,
  };
}

// Pure function called by the host. All actions use the pre-turn snapshot.
export function resolveRound(game, intents) {
  const players = structuredClone(game.players);
  const actions = {};
  for (const [uid, player] of Object.entries(game.players)) {
    if (player.hair <= 0) continue;
    const intent = intents[uid];
    try {
      requireThat(intent, 'Sin acción');
      // Validate resource/target/turn again at resolution, against the old state.
      validateIntent(game, uid, intent, phaseDeadline(game) - 1);
      actions[uid] = { action: intent.action, target: intent.target };
    } catch { actions[uid] = { action: 'distracted', target: null }; }
  }
  const hits = [];
  for (const [uid, intent] of Object.entries(actions)) {
    if (intent.action === 'air') players[uid].breath = Math.min(game.rules.maxBreath, players[uid].breath + 1);
    if (intent.action === 'blow') {
      players[uid].breath -= 1;
      const blocked = actions[intent.target]?.action === 'hide';
      hits.push({ from: uid, to: intent.target, blocked });
      if (!blocked) players[intent.target].hair = Math.max(0, players[intent.target].hair - 1);
    }
  }
  const survivors = Object.keys(players).filter(uid => players[uid].hair > 0);
  return {
    players, finished: survivors.length <= 1,
    winnerId: survivors.length === 1 ? survivors[0] : null,
    draw: survivors.length === 0,
    result: { turn: game.turn, actions, hits, losses: Object.fromEntries(
      Object.keys(players).map(uid => [uid, game.players[uid].hair - players[uid].hair])),
    },
  };
}

export function pruneLobby(room, now) {
  const members = Object.fromEntries(Object.entries(room.members)
    .filter(([, member]) => !member.left && now - millis(member.lastSeenAt) < LOBBY_LEASE_MS));
  const hostId = members[room.hostId] ? room.hostId : Object.keys(members)
    .sort((a, b) => members[a].joinedAt - members[b].joinedAt || a.localeCompare(b))[0] ?? null;
  return { ...room, members, hostId, status: hostId ? 'lobby' : 'closed' };
}

export const millis = value => value?.toMillis ? value.toMillis() : value ?? 0;
