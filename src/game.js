// Rules executed by the current room host. A match snapshots these rules, so later edits affect new games only.
export const CENTER_ITEM_TARGET = '__center_item__';
export const HAIR_ITEM_KIND = 'hair_plus_1';

export const RULES = Object.freeze({
  version: 3, initialHair: 3, maxHair: 4, initialBreath: 0, maxBreath: 2,
  minPlayers: 2, maxPlayers: 6, turnMs: 8000, revealMs: 2500,
  countdownMs: 3000,
  centerItems: true,
  itemFirstTurn: 4,
  itemMinGap: 5,
  itemCriticalGap: 4,
  itemPityGap: 9,
  itemSpawnChance: 0.18,
  itemCriticalChance: 0.45,
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

function stableUnit(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function hairItem(turn, source) {
  return { kind: HAIR_ITEM_KIND, spawnedTurn: turn, source };
}

// Item appearance is deterministic from the match seed so a host handoff cannot reroll it.
// The event is intentionally uncommon: it starts later, has a long cooldown, and uses low base odds.
// A clear HP disparity raises the odds, but never guarantees an immediate item.
export function scheduleCenterItem(game, nextTurn) {
  const current = game?.centerItem ?? null;
  const lastItemSpawnTurn = Number.isInteger(game?.lastItemSpawnTurn) ? game.lastItemSpawnTurn : 0;
  const itemOutcome = game?.lastResult?.item?.outcome;
  const consumedTurn = ['claimed', 'contested'].includes(itemOutcome) && Number.isInteger(game?.turn) ? game.turn : 0;
  // If an item lingered for several rounds, its cooldown starts when it leaves the desk.
  // Otherwise the old spawn turn can immediately trigger pity/random replacement next round.
  const cooldownTurn = Math.max(lastItemSpawnTurn, consumedTurn);
  const firstTurn = Number(game?.rules?.itemFirstTurn ?? 4);
  if (!game?.rules?.centerItems || current || !Number.isInteger(nextTurn) || nextTurn < firstTurn) {
    return { centerItem: current, lastItemSpawnTurn: current ? lastItemSpawnTurn : cooldownTurn };
  }

  const active = Object.values(game.players || {}).filter(player => player.hair > 0);
  if (active.length <= 1) return { centerItem: null, lastItemSpawnTurn };

  const minGap = Number(game.rules.itemMinGap ?? 5);
  const criticalGap = Number(game.rules.itemCriticalGap ?? 4);
  const pityGap = Number(game.rules.itemPityGap ?? 9);
  const chance = Number(game.rules.itemSpawnChance ?? 0.18);
  const criticalChance = Number(game.rules.itemCriticalChance ?? 0.45);
  const sinceLast = cooldownTurn > 0 ? nextTurn - cooldownTurn : nextTurn;
  const seed = game.itemSeed ?? `${game.roomId ?? 'room'}:${millis(game.createdAt)}`;

  if (cooldownTurn > 0 && sinceLast < criticalGap) {
    return { centerItem: null, lastItemSpawnTurn: cooldownTurn };
  }

  const hairs = active.map(player => Number(player.hair || 0));
  const minHair = Math.min(...hairs);
  const maxHair = Math.max(...hairs);
  const critical = minHair === 1 && maxHair - minHair >= 2;

  if (cooldownTurn > 0 && sinceLast < minGap) {
    return { centerItem: null, lastItemSpawnTurn: cooldownTurn };
  }

  if (sinceLast >= pityGap) {
    return { centerItem: hairItem(nextTurn, 'pity'), lastItemSpawnTurn: nextTurn };
  }

  if (critical && stableUnit(`${seed}:${nextTurn}:${HAIR_ITEM_KIND}:critical`) < criticalChance) {
    return { centerItem: hairItem(nextTurn, 'critical'), lastItemSpawnTurn: nextTurn };
  }

  if (stableUnit(`${seed}:${nextTurn}:${HAIR_ITEM_KIND}:normal`) < chance) {
    return { centerItem: hairItem(nextTurn, 'random'), lastItemSpawnTurn: nextTurn };
  }
  return { centerItem: null, lastItemSpawnTurn: cooldownTurn };
}

export function validateIntent(game, uid, intent, now) {
  requireThat(game.phase === 'choosing' && intent.turn === game.turn, 'Ese turno ya terminó.');
  requireThat(now < phaseDeadline(game), 'La acción llegó fuera de tiempo.', 'deadline-exceeded');
  requireThat(game.players[uid]?.hair > 0, 'Estás pelado o no participás.');
  requireThat(['air', 'hide', 'blow', 'grab'].includes(intent.action), 'Acción inválida.', 'invalid-argument');
  if (intent.action === 'blow') {
    requireThat(game.players[uid].breath >= 1, 'Necesitás un Soplo.');
    const playerTarget = intent.target !== uid && game.players[intent.target]?.hair > 0;
    requireThat(playerTarget, 'Elegí otro jugador activo.');
  } else if (intent.action === 'grab') {
    requireThat(intent.target === CENTER_ITEM_TARGET && game.centerItem?.kind === HAIR_ITEM_KIND,
      'El mechón ya no está disponible.');
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
    centerItem: null,
    lastItemSpawnTurn: 0,
    itemSeed: `${roomId}:${now}:${ids.join('.')}`,
    phase: 'countdown', turn: 1, countdownEndsAt: now + rules.countdownMs, deadline: now + rules.countdownMs + rules.turnMs,
    nextTurnAt: null, lastResult: null, winnerId: null, draw: false, createdAt: now,
  };
}

// Pure function called by the host. All actions use the pre-turn snapshot.
// Player damage resolves before the center item can heal anyone.
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
  const itemAttempts = [];
  for (const [uid, intent] of Object.entries(actions)) {
    if (intent.action === 'air') players[uid].breath = Math.min(game.rules.maxBreath, players[uid].breath + 1);
    if (intent.action === 'grab') itemAttempts.push(uid);
    if (intent.action === 'blow') {
      players[uid].breath -= 1;
      const blocked = actions[intent.target]?.action === 'hide';
      hits.push({ from: uid, to: intent.target, blocked });
      if (!blocked) players[intent.target].hair = Math.max(0, players[intent.target].hair - 1);
    }
  }

  const hairAfterDamage = Object.fromEntries(Object.entries(players).map(([uid, player]) => [uid, player.hair]));
  const losses = Object.fromEntries(Object.keys(players).map(uid => [uid, game.players[uid].hair - hairAfterDamage[uid]]));
  const heals = {};
  let centerItem = game.centerItem ?? null;
  let item = null;

  if (centerItem) {
    if (itemAttempts.length === 0) {
      item = { kind: centerItem.kind, outcome: 'stayed', attempts: [], winnerId: null, healed: 0, spawnedTurn: centerItem.spawnedTurn };
    } else if (itemAttempts.length === 1) {
      const winnerId = itemAttempts[0];
      const before = players[winnerId].hair;
      if (before > 0) players[winnerId].hair = Math.min(game.rules.maxHair, before + 1);
      const healed = before > 0 ? players[winnerId].hair - before : 0;
      if (healed > 0) heals[winnerId] = healed;
      item = { kind: centerItem.kind, outcome: 'claimed', attempts: itemAttempts, winnerId, healed,
        claimantAlive: before > 0, spawnedTurn: centerItem.spawnedTurn };
      centerItem = null;
    } else {
      item = { kind: centerItem.kind, outcome: 'contested', attempts: itemAttempts, winnerId: null, healed: 0, spawnedTurn: centerItem.spawnedTurn };
      centerItem = null;
    }
  }

  const survivors = Object.keys(players).filter(uid => players[uid].hair > 0);
  return {
    players, centerItem, finished: survivors.length <= 1,
    winnerId: survivors.length === 1 ? survivors[0] : null,
    draw: survivors.length === 0,
    result: { turn: game.turn, actions, hits, losses, heals, item },
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
