import { doc, FieldPath, deleteField, getDocFromServer, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { RULES, LOBBY_LEASE_MS, GAME_HOST_LEASE_MS, ABANDON_MS, SYNC_WAIT_MS, newGame, resolveRound, scheduleCenterItem, validateIntent, requireThat, validId, exactObject, millis, phaseDeadline, allMarked } from './game.js';
import { createServerClock, clockSample } from './clock.js';

export const ROOM_CODE_PATTERN = /^[A-Z2-9]{4}$/;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const createRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), n => alphabet[n % alphabet.length]).join('');
const live = (m, now, lease = LOBBY_LEASE_MS) => m && !m.left && now - millis(m.lastSeenAt) < lease;
const successor = (members, now) => Object.keys(members).filter(id => live(members[id], now))
  .sort((a, b) => members[a].joinedAt - members[b].joinedAt || a.localeCompare(b))[0] ?? null;

// This is a browser client, with normal authenticated Firestore permissions.
export function createClient(db, uid, clock = Date.now) {
  const serverClock = createServerClock(clock);
  const now = serverClock.now;
  let clockSync, lastClockSyncAt = -Infinity;
  const sessionRef = doc(db, 'sessions', uid);
  async function syncClock() {
    if (performance.now() - lastClockSyncAt < 45000) return;
    if (clockSync) return clockSync;
    clockSync = (async () => {
      let best;
      for (let sample = 0; sample < 3; sample++) {
        const start = performance.now();
        await setDoc(sessionRef, { clockAt: serverTimestamp() }, { merge: true });
        // Read latency must not bias the write's clock sample.
        const end = performance.now();
        const snap = await getDocFromServer(sessionRef);
        const measured = clockSample(snap, start, end);
        if (measured && (!best || measured.rtt < best.rtt)) best = measured;
      }
      requireThat(best, 'No pudimos confirmar la hora del servidor. Reintentá.', 'unavailable');
      requireThat(serverClock.calibrate(best.server + performance.now() - best.end, best.start, best.end),
        'La hora del servidor no es válida. Reintentá.', 'unavailable');
      lastClockSyncAt = performance.now();
    })().finally(() => { clockSync = null; });
    return clockSync;
  }
  async function saveProfile(data) {
    exactObject(data, ['name']);
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    requireThat(name.length >= 1 && name.length <= 24 && !/[\u0000-\u001f\u007f]/.test(name), 'Usá un nombre de 1 a 24 caracteres.');
    await runTransaction(db, async tx => {
      const ref = doc(db, 'profiles', uid), old = (await tx.get(ref)).data();
      requireThat(!old || old.schemaVersion === 1, 'Actualizá la aplicación para usar este perfil.');
      tx.set(ref, { name, schemaVersion: 1, dataVersion: 1, updatedAt: serverTimestamp(),
        ...(!old ? { createdAt: serverTimestamp() } : {}) }, { merge: true });
    });
    return { name };
  }
  async function roomCommand(data) {
    exactObject(data, ['command', 'code', 'roomId', 'ready']);
    const { command } = data;
    requireThat(['create','join','touch','leave','ready','start','lobby','rename'].includes(command), 'Comando inválido.');
    if (command === 'join') requireThat(ROOM_CODE_PATTERN.test(data.code), 'El código tiene 4 letras o números.');
    if (!['create','join'].includes(command)) validId(data.roomId);
    if (command === 'touch') {
      const ref = doc(db, 'rooms', data.roomId);
      const old = (await getDocFromServer(ref)).data();
      requireThat(old && old.status !== 'closed', 'La sala ya no está disponible.', 'not-found');
      requireThat(old.schemaVersion === 3, 'Esta sala pertenece a una versión anterior. Creá una sala nueva.');
      requireThat(old.members[uid] && !old.members[uid].left, 'Volvé a entrar con el código.', 'permission-denied');
      const lease = ['playing','finished'].includes(old.status) ? GAME_HOST_LEASE_MS : LOBBY_LEASE_MS;
      if (old.hostId !== uid && live(old.members[old.hostId], now(), lease)) {
        await updateDoc(ref,
          new FieldPath('members', uid, 'lastSeenAt'), serverTimestamp(),
          'updatedAt', serverTimestamp());
        return { roomId: data.roomId };
      }
      // Sólo el caso excepcional de relevo de host necesita la transacción completa.
    }
    const gameRef = doc(db, 'games', crypto.randomUUID());
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = createRoomCode();
      try {
        return await runTransaction(db, async tx => {
          const time = now();
          const profile = (await tx.get(doc(db, 'profiles', uid))).data();
          requireThat(profile, 'Primero elegí tu nombre.');
          const session = (await tx.get(sessionRef)).data();
          const id = command === 'create' ? candidate : command === 'join' ? data.code : data.roomId;
          const ref = doc(db, 'rooms', id);
          const old = (await tx.get(ref)).data();
          let activeGame = null;
          if (old?.gameId && command !== 'join' && ['playing','finished'].includes(old.status)) {
            activeGame = (await tx.get(doc(db, 'games', old.gameId))).data();
          }
          if (command === 'create') {
            requireThat(!old, 'CODE_COLLISION');
            tx.set(ref, { schemaVersion: 3, code: id, hostId: uid, status: 'lobby', gameId: null,
              members: { [uid]: { name: profile.name, joinedAt: time, lastSeenAt: serverTimestamp(), left: false, ready: false } },
              wins: {}, matchCount: 0,
              createdAt: time, updatedAt: serverTimestamp() });
            tx.set(sessionRef, { roomId: id, updatedAt: serverTimestamp() }, { merge: true });
            return { roomId: id };
          }
          requireThat(old && old.status !== 'closed', 'La sala ya no está disponible.', 'not-found');
          requireThat(old.schemaVersion === 3, 'Esta sala pertenece a una versión anterior. Creá una sala nueva.');
          let room = { ...old, members: { ...old.members } };
          if (command !== 'join') requireThat(room.members[uid] && !room.members[uid].left, 'Volvé a entrar con el código.', 'permission-denied');
          if (command === 'join') {
            requireThat(['lobby','playing','finished'].includes(room.status) || room.members[uid], 'La sala ya no está disponible.');
            requireThat(room.members[uid] || Object.keys(room.members).length < RULES.maxPlayers, 'La sala está llena.');
            const joiningActiveMatch = ['playing','finished'].includes(room.status) && !room.members[uid];
            room.members[uid] = { name: profile.name, joinedAt: room.members[uid]?.joinedAt ?? time, lastSeenAt: serverTimestamp(), left: false,
              ready: joiningActiveMatch ? false : (room.members[uid]?.ready ?? false) };
            tx.set(sessionRef, { roomId: id, updatedAt: serverTimestamp() }, { merge: true });
          } else if (command === 'leave') {
            if (room.status === 'lobby') delete room.members[uid];
            else if (['playing','finished'].includes(room.status) && room.gameId && !activeGame?.memberIds?.includes(uid)) {
              // A late spectator owns only a future lobby seat. Leaving must never abort the match.
              delete room.members[uid];
            } else if (room.status === 'playing' && room.gameId) {
              // Leaving an active match closes that match for every participant.
              const activeGameRef = doc(db, 'games', room.gameId);
              room.members[uid] = { ...room.members[uid], left: true, lastSeenAt: serverTimestamp() };
              room.status = 'closed'; room.gameId = null;
              if (activeGame && !['finished', 'abandoned'].includes(activeGame.phase)) {
                tx.update(activeGameRef, { phase: 'abandoned', finishedAt: time, abandonedAt: serverTimestamp() });
              }
            } else room.members[uid] = { ...room.members[uid], left: true, lastSeenAt: serverTimestamp() };
            if (room.hostId === uid) {
              room.hostId = successor(room.members, time) ?? (Object.keys(room.members).find(id => id !== uid && !room.members[id].left) ?? uid);
              if (!Object.values(room.members).some(m => !m.left)) room.status = 'closed';
            }
            if (session?.roomId === id) tx.set(sessionRef, { roomId: null, updatedAt: serverTimestamp() }, { merge: true });
          } else {
            room.members[uid] = { ...room.members[uid], lastSeenAt: serverTimestamp() };
            // Read the old lease; the transaction conflicts with a returning host's heartbeat.
            if (!live(old.members[old.hostId], time, ['playing','finished'].includes(old.status) ? GAME_HOST_LEASE_MS : LOBBY_LEASE_MS)
              && (old.status !== 'playing' || activeGame?.memberIds?.includes(uid))) room.hostId = uid;
            if (command === 'ready') {
              room.members[uid] = { ...room.members[uid], ready: data.ready === true };
            }
            if (command === 'rename') {
              requireThat(room.status === 'lobby', 'El nombre no puede cambiar durante la partida.');
              room.members[uid] = { ...room.members[uid], name: profile.name };
            }
            if (command === 'start') {
              requireThat(old.hostId === uid, 'Solo el host puede iniciar.', 'permission-denied');
              if (room.status !== 'playing') {
                requireThat(room.status === 'lobby', 'Volvé al lobby antes de iniciar otra partida.');
                // A player can remain marked Ready after closing the tab. Do not carry stale seats into a match.
                room.members = Object.fromEntries(Object.entries(room.members)
                  .filter(([memberId,m]) => !m.left && (memberId === uid || live(m, time))));
                requireThat(Object.keys(room.members).length >= RULES.minPlayers, 'Esperá a que vuelva otro jugador conectado.');
                requireThat(Object.values(room.members).every(m => m.ready), 'Todos los jugadores conectados deben estar listos.');
                const game = newGame(id, room.members, time);
                tx.set(gameRef, { ...game, phaseStartedAt: serverTimestamp(), lastProgressAt: serverTimestamp() }); room.status = 'playing'; room.gameId = gameRef.id;
              }
            }
            if (command === 'lobby') {
              requireThat(old.hostId === uid, 'Solo el host puede volver al lobby.', 'permission-denied');
              requireThat(['lobby','finished'].includes(room.status), 'La partida sigue en curso.');
              room.members = Object.fromEntries(Object.entries(room.members)
                .filter(([id,m]) => id === uid || live(m,time))
                .map(([id,m]) => [id, { ...m, ready: false }]));
              room.status = 'lobby'; room.gameId = null;
            }
            if (command === 'touch' && old.hostId === uid && room.status === 'lobby') {
              room.members = Object.fromEntries(Object.entries(room.members).filter(([id,m]) => id === uid || live(m,time)));
            }
            if (command === 'touch' && old.hostId === uid && ['playing','finished'].includes(room.status) && activeGame) {
              // Keep active match participants even while reconnecting, but do not let abandoned
              // late-spectator seats block the room until the match returns to the lobby.
              const participants = new Set(activeGame.memberIds || []);
              room.members = Object.fromEntries(Object.entries(room.members)
                .filter(([id,m]) => participants.has(id) || id === uid || live(m,time)));
            }
          }
          // A full-document replacement can fail rules before a stale transaction
          // retries, because it also overwrites another player's newer heartbeat.
          const changes = ['updatedAt', serverTimestamp()];
          for (const key of ['hostId', 'status', 'gameId']) {
            if (room[key] !== old[key]) changes.push(key, room[key]);
          }
          for (const memberId of new Set([...Object.keys(old.members), ...Object.keys(room.members)])) {
            if (room.members[memberId] !== old.members[memberId]) {
              changes.push(new FieldPath('members', memberId), room.members[memberId] ?? deleteField());
            }
          }
          tx.update(ref, ...changes);
          return { roomId: command === 'leave' ? null : id };
        }, { maxAttempts: 10 });
      } catch (error) { if (error.message !== 'CODE_COLLISION') throw error; }
    }
    throw new Error('No pudimos crear el código. Reintentá.');
  }
  async function clearRoomSession(data) {
    exactObject(data, ['roomId']);
    await runTransaction(db, async tx => {
      const session = (await tx.get(sessionRef)).data();
      if ('roomId' in data && session?.roomId !== data.roomId) return;
      tx.set(sessionRef, { roomId: null, updatedAt: serverTimestamp() }, { merge: true });
    });
    return { roomId: null };
  }
  async function submitIntent(data) {
    exactObject(data, ['gameId','turn','action','target','requestId','expectedRevision']);
    validId(data.gameId); validId(data.requestId);
    return runTransaction(db, async tx => {
      const gameRef = doc(db, 'games', data.gameId);
      const game = (await tx.get(gameRef)).data();
      requireThat(game?.memberIds.includes(uid), 'No pertenecés a esta partida.');
      // Keep the room heartbeat out of this transaction's read set. The active host
      // touches its room frequently, and reading that document here can force the
      // intent transaction to retry until the turn expires. Firestore Rules still
      // verify current room membership atomically when these writes commit.
      const ref = doc(db, 'games', data.gameId, 'intents', uid), old = (await tx.get(ref)).data();
      validateIntent(game, uid, data, now());
      if (old?.turn === data.turn && old.requestId === data.requestId) return old;
      requireThat(game.protocolVersion !== 2 || !allMarked(game, 'chosen'), 'Todos eligieron. Resolviendo el turno.');
      const revision = old?.turn === game.turn ? old.revision : 0;
      requireThat(data.expectedRevision === revision, 'La acción cambió en otra pestaña. Volvé a elegir.', 'aborted');
      const intent = { turn: game.turn, action: data.action, target: data.target, requestId: data.requestId, revision: revision + 1 };
      tx.set(ref, { ...intent, submittedAt: serverTimestamp() });
      if (game.protocolVersion === 2) tx.update(gameRef, { [`chosen.${uid}`]: true });
      return intent;
    }, { maxAttempts: 10 });
  }
  async function acknowledgeRound({ gameId, turn }) {
    validId(gameId);
    return runTransaction(db, async tx => {
      const ref = doc(db, 'games', gameId), game = (await tx.get(ref)).data();
      if (!game || game.protocolVersion !== 2 || game.turn !== turn
        || !['countdown', 'syncing'].includes(game.phase) || game.ready[uid]) return {};
      requireThat(game.memberIds.includes(uid), 'No pertenecés a esta partida.');
      tx.update(ref, { [`ready.${uid}`]: true });
      return {};
    });
  }
  async function abandonGame({ gameId }) {
    validId(gameId);
    return runTransaction(db, async tx => {
      const gameRef = doc(db, 'games', gameId), game = (await tx.get(gameRef)).data();
      requireThat(game?.memberIds.includes(uid), 'No pertenecés a esta partida.');
      const roomRef = doc(db, 'rooms', game.roomId), room = (await tx.get(roomRef)).data();
      requireThat(room?.gameId === gameId && room.members[uid] && !room.members[uid].left, 'Volvé a la sala.');
      const marker = millis(game.lastProgressAt || game.phaseStartedAt || game.finishedAt);
      requireThat(marker > 0 && now() - marker > ABANDON_MS, 'La partida todavía está activa.');
      if (!['finished', 'abandoned'].includes(game.phase)) tx.update(gameRef, { phase: 'abandoned', finishedAt: now(), abandonedAt: serverTimestamp() });
      tx.update(roomRef, { status: 'closed', gameId: null, updatedAt: serverTimestamp() });
      return { roomId: null };
    });
  }
  async function advanceGame({ gameId, turn, phase }) {
    validId(gameId);
    const initial = (await getDocFromServer(doc(db, 'games', gameId))).data();
    if (!initial || initial.turn !== turn || initial.phase !== phase) return { advanced: false };
    const synchronized = initial.protocolVersion === 2;
    if (synchronized && phase === 'choosing') {
      const locked = await runTransaction(db, async tx => {
        const ref = doc(db, 'games', gameId), game = (await tx.get(ref)).data();
        if (game.turn !== turn || game.phase !== 'choosing') return false;
        const room = (await tx.get(doc(db, 'rooms', game.roomId))).data();
        requireThat(room?.hostId === uid && !room.members[uid]?.left, 'Solo el host resuelve.', 'permission-denied');
        if (now() < phaseDeadline(game) && !allMarked(game, 'chosen')) return false;
        tx.update(ref, { phase: 'locked', lastProgressAt: serverTimestamp() });
        return true;
      }, { maxAttempts: 10 });
      if (!locked) return { advanced: false };
      phase = 'locked';
    }
    let resolvedIntents = {};
    if (phase === 'choosing' || phase === 'locked') {
      const preview = (await getDocFromServer(doc(db, 'games', gameId))).data();
      if (!preview || preview.turn !== turn || preview.phase !== phase || (phase === 'choosing' && now() < phaseDeadline(preview))) return { advanced: false };
      // These are independent server reads, not one batched get. Resolve them concurrently so
      // a six-player reveal pays roughly one network RTT instead of up to six in series.
      const snapshots = await Promise.all(preview.memberIds.map(memberId =>
        getDocFromServer(doc(db, 'games', gameId, 'intents', memberId))));
      resolvedIntents = Object.fromEntries(snapshots.filter(snapshot => snapshot.exists()).map(snapshot => [snapshot.id, snapshot.data()]));
    }
    return runTransaction(db, async tx => {
      const time = now(), ref = doc(db, 'games', gameId), game = (await tx.get(ref)).data();
      if (!game || !['countdown','syncing','choosing','locked','reveal'].includes(game.phase) || game.turn !== turn || game.phase !== phase) return { advanced: false };
      const roomRef = doc(db, 'rooms', game.roomId), room = (await tx.get(roomRef)).data();
      requireThat(room?.hostId === uid && !room.members[uid]?.left, 'Solo el host resuelve.', 'permission-denied');
      const deadline = phaseDeadline(game);
      if (room.gameId !== gameId) return { advanced: false };
      if (phase !== 'locked' && !(phase === 'syncing' && allMarked(game, 'ready')) && time < deadline) return { advanced: false };
      // New synchronized games use Firestore's phaseStartedAt as the only clock source.
      // Do not hold the whole match at 0 waiting for per-device acknowledgements.
      if (phase === 'countdown' || phase === 'syncing') {
        tx.update(ref, { phase: 'choosing', deadline: time + game.rules.turnMs, countdownEndsAt: null,
          lastProgressAt: serverTimestamp(), ...(synchronized ? { phaseStartedAt: serverTimestamp() } : {}) });
      } else if (phase === 'reveal') {
        const scheduledItem = scheduleCenterItem(game, game.turn + 1);
        tx.update(ref, { phase: 'choosing', turn: game.turn + 1, deadline: time + game.rules.turnMs, nextTurnAt: null,
          centerItem: scheduledItem.centerItem, lastItemSpawnTurn: scheduledItem.lastItemSpawnTurn,
          lastProgressAt: serverTimestamp(), ...(synchronized ? { phaseStartedAt: serverTimestamp(), ready: {}, chosen: {} } : {}) });
      } else {
        if (game.resolvedTurn >= game.turn) return { advanced: false };
        const resultRef = doc(db, 'games', gameId, 'rounds', String(game.turn));
        if ((await tx.get(resultRef)).exists()) return { advanced: false };
        // Locked intentions cannot change. Legacy games freeze at their deadline.
        // This transaction still protects game/host/turn authority and idempotency.
        const result = resolveRound({ ...game, phase: 'choosing' }, resolvedIntents);
        tx.set(resultRef, { ...result.result, resolvedBy: uid, resolvedAt: serverTimestamp() });
        tx.update(ref, { players: result.players, centerItem: result.centerItem, lastResult: result.result, resolvedTurn: game.turn,
          phase: result.finished ? 'finished' : 'reveal', winnerId: result.winnerId, draw: result.draw,
          nextTurnAt: result.finished ? null : time + game.rules.revealMs,
          lastProgressAt: serverTimestamp(), ...(synchronized ? { phaseStartedAt: serverTimestamp() } : {}),
          ...(result.finished ? { finishedAt: time } : {}) });
        if (result.finished) {
          const wins = { ...(room.wins ?? {}) };
          if (result.winnerId) wins[result.winnerId] = Number(wins[result.winnerId] || 0) + 1;
          tx.update(roomRef, { status: 'finished', wins, matchCount: Number(room.matchCount || 0) + 1, updatedAt: serverTimestamp() });
        }
      }
      return { advanced: true };
    }, { maxAttempts: 10 });
  }
  const commands = { saveProfile, roomCommand, clearRoomSession, submitIntent, acknowledgeRound, abandonGame, advanceGame };
  return { now, syncClock, call: async (name, data) => {
    requireThat(commands[name], 'Comando inválido.');
    // Creating/joining a lobby can be instant; a match itself always starts from a fresh server clock.
    if (name === 'roomCommand' && data?.command === 'start') await syncClock();
    return { ...await commands[name](data), serverNow: now() };
  } };
}
