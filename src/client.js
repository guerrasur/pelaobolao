import { doc, getDocFromServer, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { RULES, LOBBY_LEASE_MS, newGame, resolveRound, validateIntent, requireThat, validId, exactObject, millis } from './game.js';

export const ROOM_CODE_PATTERN = /^[A-Z2-9]{4}$/;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const createRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), n => alphabet[n % alphabet.length]).join('');
const live = (m, now) => m && !m.left && now - millis(m.lastSeenAt) < LOBBY_LEASE_MS;
const successor = (members, now) => Object.keys(members).filter(id => live(members[id], now))
  .sort((a, b) => members[a].joinedAt - members[b].joinedAt || a.localeCompare(b))[0] ?? null;

// This is a browser client, with normal authenticated Firestore permissions.
export function createClient(db, uid, clock = Date.now) {
  let offset = 0;
  const now = () => clock() + offset;
  const sessionRef = doc(db, 'sessions', uid);
  async function syncClock() {
    const start = clock();
    await setDoc(sessionRef, { clockAt: serverTimestamp() }, { merge: true });
    const snap = await getDocFromServer(sessionRef);
    offset = millis(snap.data().clockAt) - (start + clock()) / 2;
    return offset;
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
    const gameRef = doc(db, 'games', crypto.randomUUID());
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = createRoomCode();
      try {
        return await runTransaction(db, async tx => {
          const time = now();
          const profile = (await tx.get(doc(db, 'profiles', uid))).data();
          requireThat(profile, 'Primero elegí tu nombre.');
          const session = (await tx.get(sessionRef)).data();
          if (command === 'create' && session?.roomId) {
            const existing = (await tx.get(doc(db, 'rooms', session.roomId))).data();
            if (existing && existing.status !== 'closed' && existing.members[uid] && !existing.members[uid].left)
              return { roomId: session.roomId };
          }
          const id = command === 'create' ? candidate : command === 'join' ? data.code : data.roomId;
          const ref = doc(db, 'rooms', id);
          const old = (await tx.get(ref)).data();
          if (command === 'create') {
            requireThat(!old, 'CODE_COLLISION');
            tx.set(ref, { schemaVersion: 3, code: id, hostId: uid, status: 'lobby', gameId: null,
              members: { [uid]: { name: profile.name, joinedAt: time, lastSeenAt: serverTimestamp(), left: false, ready: false } },
              createdAt: time, updatedAt: serverTimestamp() });
            tx.set(sessionRef, { roomId: id, updatedAt: serverTimestamp() }, { merge: true });
            return { roomId: id };
          }
          requireThat(old && old.status !== 'closed', 'La sala ya no está disponible.', 'not-found');
          requireThat(old.schemaVersion === 3, 'Esta sala pertenece a una versión anterior. Creá una sala nueva.');
          let room = { ...old, members: { ...old.members } };
          if (command !== 'join') requireThat(room.members[uid] && !room.members[uid].left, 'Volvé a entrar con el código.', 'permission-denied');
          if (command === 'join') {
            requireThat(room.status === 'lobby' || room.members[uid], 'La partida ya empezó.');
            requireThat(room.members[uid] || Object.keys(room.members).length < RULES.maxPlayers, 'La sala está llena.');
            room.members[uid] = { name: profile.name, joinedAt: room.members[uid]?.joinedAt ?? time, lastSeenAt: serverTimestamp(), left: false, ready: room.members[uid]?.ready ?? false };
            tx.set(sessionRef, { roomId: id, updatedAt: serverTimestamp() }, { merge: true });
          } else if (command === 'leave') {
            if (room.status === 'lobby') delete room.members[uid];
            else room.members[uid] = { ...room.members[uid], left: true, lastSeenAt: serverTimestamp() };
            if (room.hostId === uid) {
              room.hostId = successor(room.members, time) ?? (Object.keys(room.members).find(id => id !== uid && !room.members[id].left) ?? uid);
              if (!Object.values(room.members).some(m => !m.left)) room.status = 'closed';
            }
            tx.set(sessionRef, { roomId: null, updatedAt: serverTimestamp() }, { merge: true });
          } else {
            room.members[uid] = { ...room.members[uid], lastSeenAt: serverTimestamp() };
            // Read the old lease; the transaction conflicts with a returning host's heartbeat.
            if (!live(old.members[old.hostId], time)) room.hostId = uid;
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
                room.members = Object.fromEntries(Object.entries(room.members).filter(([,m]) => !m.left));
                requireThat(Object.keys(room.members).length >= RULES.minPlayers && Object.values(room.members).every(m => m.ready), 'Todos los jugadores deben estar listos.');
                const game = newGame(id, room.members, time);
                tx.set(gameRef, game); room.status = 'playing'; room.gameId = gameRef.id;
              }
            }
            if (command === 'lobby') {
              requireThat(old.hostId === uid, 'Solo el host puede volver al lobby.', 'permission-denied');
              requireThat(['lobby','finished'].includes(room.status), 'La partida sigue en curso.');
              room.members = Object.fromEntries(Object.entries(room.members).filter(([id,m]) => id === uid || live(m,time)));
              room.status = 'lobby'; room.gameId = null;
            }
            if (command === 'touch' && old.hostId === uid && room.status === 'lobby') {
              room.members = Object.fromEntries(Object.entries(room.members).filter(([id,m]) => id === uid || live(m,time)));
            }
          }
          tx.set(ref, { ...room, updatedAt: serverTimestamp() });
          return { roomId: command === 'leave' ? null : id };
        });
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
      const room = (await tx.get(doc(db, 'rooms', game.roomId))).data();
      requireThat(room?.gameId === data.gameId && room.members[uid] && !room.members[uid].left, 'Volvé a la sala.');
      const ref = doc(db, 'games', data.gameId, 'intents', uid), old = (await tx.get(ref)).data();
      validateIntent(game, uid, data, now());
      if (old?.turn === data.turn && old.requestId === data.requestId) return old;
      const revision = old?.turn === game.turn ? old.revision : 0;
      requireThat(data.expectedRevision === revision, 'La acción cambió en otra pestaña. Volvé a elegir.', 'aborted');
      const intent = { turn: game.turn, action: data.action, target: data.target, requestId: data.requestId, revision: revision + 1 };
      tx.set(ref, { ...intent, submittedAt: serverTimestamp() });
      return intent;
    });
  }
  async function advanceGame({ gameId, turn, phase }) {
    validId(gameId);
    let resolvedIntents = {};
    if (phase === 'choosing') {
      const preview = (await getDocFromServer(doc(db, 'games', gameId))).data();
      if (!preview || preview.turn !== turn || preview.phase !== phase || now() < preview.deadline) return { advanced: false };
      const snapshots = [];
      // Keep these reads sequential: Firestore applies a stricter rules lookup budget to
      // batched reads. At most six small documents are loaded once per completed turn.
      for (const memberId of preview.memberIds) {
        snapshots.push(await getDocFromServer(doc(db, 'games', gameId, 'intents', memberId)));
      }
      resolvedIntents = Object.fromEntries(snapshots.filter(snapshot => snapshot.exists()).map(snapshot => [snapshot.id, snapshot.data()]));
    }
    return runTransaction(db, async tx => {
      const time = now(), ref = doc(db, 'games', gameId), game = (await tx.get(ref)).data();
      if (!game || !['countdown','choosing','reveal'].includes(game.phase) || game.turn !== turn || game.phase !== phase) return { advanced: false };
      const roomRef = doc(db, 'rooms', game.roomId), room = (await tx.get(roomRef)).data();
      requireThat(room?.hostId === uid && !room.members[uid]?.left, 'Solo el host resuelve.', 'permission-denied');
      const phaseDeadline = phase === 'countdown' ? game.countdownEndsAt : phase === 'choosing' ? game.deadline : game.nextTurnAt;
      if (room.gameId !== gameId || time < phaseDeadline) return { advanced: false };
      if (phase === 'countdown') {
        tx.update(ref, { phase: 'choosing', deadline: time + game.rules.turnMs, countdownEndsAt: null });
      } else if (phase === 'reveal') {
        tx.update(ref, { phase: 'choosing', turn: game.turn + 1, deadline: time + game.rules.turnMs, nextTurnAt: null });
      } else {
        if (game.resolvedTurn >= game.turn) return { advanced: false };
        const resultRef = doc(db, 'games', gameId, 'rounds', String(game.turn));
        if ((await tx.get(resultRef)).exists()) return { advanced: false };
        // Intentions are queried once after the deadline. Rules prevent edits after that
        // instant, while this transaction still protects the game/host/turn authority.
        const result = resolveRound(game, resolvedIntents);
        tx.set(resultRef, { ...result.result, resolvedBy: uid, resolvedAt: serverTimestamp() });
        tx.update(ref, { players: result.players, lastResult: result.result, resolvedTurn: game.turn,
          phase: result.finished ? 'finished' : 'reveal', winnerId: result.winnerId, draw: result.draw,
          nextTurnAt: result.finished ? null : time + game.rules.revealMs,
          ...(result.finished ? { finishedAt: time } : {}) });
        if (result.finished) tx.update(roomRef, { status: 'finished', updatedAt: serverTimestamp() });
      }
      return { advanced: true };
    });
  }
  const commands = { saveProfile, roomCommand, clearRoomSession, submitIntent, advanceGame };
  return { now, syncClock, call: async (name, data) => {
    requireThat(commands[name], 'Comando inválido.');
    return { ...await commands[name](data), serverNow: now() };
  } };
}
