import { randomInt } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { RULES, ABANDON_MS, exactObject, validId, requireThat, newGame, pruneLobby, resolveRound, validateIntent } from './game.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const expires = now => Timestamp.fromMillis(now + 7 * 86400000);

export function createService(db, clock = Date.now) {
  const job = (tx, gameId, game, now) => {
    const runAt = game.phase === 'choosing' ? game.deadline : game.nextTurnAt;
    tx.create(db.doc(`jobs/${gameId}-${game.turn}-${game.phase}`), {
      gameId, turn: game.turn, phase: game.phase, runAt, expiresAt: expires(now),
    });
  };

  async function saveProfile(uid, data) {
    exactObject(data, ['name']);
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    requireThat(name.length >= 1 && name.length <= 24 && !/[\u0000-\u001f\u007f]/.test(name), 'Usá un nombre de 1 a 24 caracteres.', 'invalid-argument');
    return db.runTransaction(async tx => {
      const ref = db.doc(`profiles/${uid}`);
      const old = await tx.get(ref);
      requireThat(!old.exists || old.data().schemaVersion === 1, 'Actualizá la aplicación para usar este perfil.');
      // Do not overwrite future persistent progress when updating a display name.
      tx.set(ref, { name, schemaVersion: 1, updatedAt: clock(), ...(old.exists ? {} : { createdAt: clock() }) }, { merge: true });
      return { name };
    });
  }

  async function roomCommand(uid, data) {
    exactObject(data, ['command', 'code', 'roomId']);
    requireThat(['create', 'join', 'touch', 'leave', 'start', 'lobby'].includes(data.command), 'Comando inválido.', 'invalid-argument');
    if (data.command === 'join') requireThat(typeof data.code === 'string' && /^[A-Z2-9]{6}$/.test(data.code), 'El código tiene 6 letras o números.', 'invalid-argument');
    if (!['create', 'join'].includes(data.command)) validId(data.roomId);
    // IDs are stable across transaction retries. Creation is also guarded by the UID session.
    const roomRef = db.collection('rooms').doc();
    const gameRef = db.collection('games').doc();
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidateCode = code();
      try {
        return await db.runTransaction(async tx => {
          const now = clock();
          const profile = await tx.get(db.doc(`profiles/${uid}`));
          requireThat(profile.exists, 'Primero elegí tu nombre.');
          const sessionRef = db.doc(`sessions/${uid}`);
          const session = (await tx.get(sessionRef)).data();
          if (data.command === 'create') {
            if (session?.roomId) {
              const existing = (await tx.get(db.doc(`rooms/${session.roomId}`))).data();
              if (existing && existing.status !== 'closed' && existing.members[uid] && !existing.members[uid].left) {
                return { roomId: session.roomId, serverNow: now };
              }
            }
            const codeRef = db.doc(`roomCodes/${candidateCode}`);
            requireThat(!(await tx.get(codeRef)).exists, 'CODE_COLLISION', 'already-exists');
            tx.create(roomRef, {
              schemaVersion: 1, code: candidateCode, hostId: uid, status: 'lobby', gameId: null,
              members: { [uid]: { name: profile.data().name, joinedAt: now, lastSeenAt: now, left: false } },
              createdAt: now, updatedAt: now, expiresAt: expires(now),
            });
            tx.create(codeRef, { roomId: roomRef.id, expiresAt: expires(now) });
            tx.set(sessionRef, { roomId: roomRef.id, updatedAt: now });
            return { roomId: roomRef.id, serverNow: now };
          }
          let id = data.roomId;
          if (data.command === 'join') {
            id = (await tx.get(db.doc(`roomCodes/${data.code}`))).data()?.roomId;
            requireThat(id, 'No encontramos esa sala.', 'not-found');
            if (session?.roomId && session.roomId !== id) {
              const current = (await tx.get(db.doc(`rooms/${session.roomId}`))).data();
              requireThat(!current || current.status === 'closed' || !current.members[uid] || current.members[uid].left,
                'Salí de la sala actual antes de entrar a otra.');
            }
          }
          const ref = db.doc(`rooms/${id}`);
          let room = (await tx.get(ref)).data();
          requireThat(room && room.status !== 'closed', 'La sala ya no está disponible.', 'not-found');
          if (data.command !== 'join') requireThat(room.members[uid], 'No pertenecés a esta sala.', 'permission-denied');
          if (data.command === 'join') {
            if (room.status === 'lobby') {
              // A returning member gets a fresh lease before pruning other stale members.
              if (room.members[uid]) room.members[uid] = { ...room.members[uid], lastSeenAt: now, left: false };
              room = pruneLobby(room, now);
              requireThat(Object.keys(room.members).length < RULES.maxPlayers || room.members[uid], 'La sala está llena.');
            } else requireThat(room.members[uid], 'La partida ya empezó. Esperá la próxima.');
            room.members[uid] = { name: profile.data().name, joinedAt: room.members[uid]?.joinedAt ?? now, lastSeenAt: now, left: false };
            if (!room.hostId) room.hostId = uid;
            if (room.status === 'closed') room.status = 'lobby';
            tx.set(sessionRef, { roomId: id, updatedAt: now });
          } else if (data.command === 'leave') {
            if (room.status === 'playing') room.members[uid] = { ...room.members[uid], left: true, lastSeenAt: 0 };
            else {
              delete room.members[uid];
              const pruned = pruneLobby(room, now);
              room.members = pruned.members;
              room.hostId = pruned.hostId;
              if (!room.hostId) room.status = 'closed';
            }
            if (session?.roomId === id) tx.set(sessionRef, { roomId: null, updatedAt: now });
          } else {
            requireThat(!room.members[uid].left, 'Volvé a unirte con el código.');
            room.members[uid].lastSeenAt = now;
            room.members[uid].name = profile.data().name;
            if (room.status === 'lobby') room = pruneLobby(room, now);
            // Finished games also elect a replacement host, without removing spectators yet.
            if (room.status === 'finished') room.hostId = pruneLobby(room, now).hostId;
            if (data.command === 'start') {
              requireThat(room.hostId === uid, 'Solo el host puede iniciar.', 'permission-denied');
              if (room.status !== 'playing') {
                requireThat(room.status === 'lobby', 'Volvé al lobby antes de iniciar otra partida.');
                const game = newGame(id, room.members, now);
                tx.create(gameRef, { ...game, expiresAt: expires(now) });
                job(tx, gameRef.id, game, now);
                room.status = 'playing'; room.gameId = gameRef.id;
              }
            }
            if (data.command === 'lobby') {
              requireThat(room.hostId === uid, 'Solo el host puede volver al lobby.', 'permission-denied');
              requireThat(['lobby', 'finished'].includes(room.status), 'La partida sigue en curso.');
              room = pruneLobby(room, now); room.gameId = null;
            }
          }
          tx.set(ref, { ...room, updatedAt: now, expiresAt: expires(now) });
          return { roomId: data.command === 'leave' ? null : id, serverNow: now };
        });
      } catch (error) {
        if (error.message !== 'CODE_COLLISION') throw error;
      }
    }
    requireThat(false, 'No pudimos crear el código. Reintentá.', 'unavailable');
  }

  async function submitIntent(uid, data) {
    exactObject(data, ['gameId', 'turn', 'action', 'target', 'requestId', 'expectedRevision']);
    validId(data.gameId); validId(data.requestId);
    requireThat(Number.isSafeInteger(data.turn) && Number.isSafeInteger(data.expectedRevision) && data.expectedRevision >= 0,
      'Turno o revisión inválidos.', 'invalid-argument');
    return db.runTransaction(async tx => {
      const ref = db.doc(`games/${data.gameId}`);
      const game = (await tx.get(ref)).data();
      requireThat(game && game.memberIds.includes(uid), 'No pertenecés a esta partida.', 'permission-denied');
      const room = (await tx.get(db.doc(`rooms/${game.roomId}`))).data();
      requireThat(room?.gameId === data.gameId && room.members[uid] && !room.members[uid].left, 'Volvé a la sala.');
      const intentRef = ref.collection('intents').doc(uid);
      const old = (await tx.get(intentRef)).data();
      // A replay returns the original receipt, never applying the action twice.
      if (old?.turn === data.turn && old.requestId === data.requestId) return { ...old, serverNow: clock() };
      validateIntent(game, uid, data, clock());
      const revision = old?.turn === game.turn ? old.revision : 0;
      requireThat(data.expectedRevision === revision, 'La acción cambió en otra pestaña. Volvé a elegir.', 'aborted');
      const intent = {
        turn: game.turn, action: data.action, target: data.target,
        requestId: data.requestId, revision: revision + 1, submittedAt: clock(),
      };
      tx.set(intentRef, intent);
      return { ...intent, serverNow: clock() };
    });
  }

  // Both task deliveries and client wake-ups use this exact transaction.
  async function advance(gameId, expected = null, uid = null) {
    validId(gameId);
    return db.runTransaction(async tx => {
      const now = clock();
      const ref = db.doc(`games/${gameId}`);
      const game = (await tx.get(ref)).data();
      if (!game) return { advanced: false, serverNow: now };
      if (uid) requireThat(game.memberIds.includes(uid), 'No pertenecés a esta partida.', 'permission-denied');
      if (expected && (game.turn !== expected.turn || game.phase !== expected.phase)) return { advanced: false, serverNow: now };
      if (!['choosing', 'reveal'].includes(game.phase)) return { advanced: false, serverNow: now };
      const due = game.phase === 'choosing' ? game.deadline : game.nextTurnAt;
      if (now < due) return { advanced: false, serverNow: now, due };
      const roomRef = db.doc(`rooms/${game.roomId}`);
      const room = (await tx.get(roomRef)).data();
      if (!room || room.gameId !== gameId) return { advanced: false, serverNow: now };
      if (!Object.values(room.members).some(member => !member.left && now - member.lastSeenAt < ABANDON_MS)) {
        tx.update(ref, { phase: 'abandoned', finishedAt: now });
        tx.update(roomRef, { status: 'finished', updatedAt: now });
        return { advanced: true, serverNow: now };
      }
      if (game.phase === 'reveal') {
        const next = { ...game, phase: 'choosing', turn: game.turn + 1, deadline: now + game.rules.turnMs, nextTurnAt: null };
        tx.set(ref, next);
        job(tx, gameId, next, now);
      } else {
        const snapshots = await tx.getAll(...game.memberIds.map(id => ref.collection('intents').doc(id)));
        const intents = Object.fromEntries(snapshots.filter(s => s.exists).map(s => [s.id, s.data()]));
        const result = resolveRound(game, intents);
        const next = {
          ...game, players: result.players, lastResult: result.result,
          phase: result.finished ? 'finished' : 'reveal', winnerId: result.winnerId, draw: result.draw,
          nextTurnAt: result.finished ? null : now + game.rules.revealMs,
        };
        if (result.finished) next.finishedAt = now;
        // The round record, public state and next task are committed atomically.
        tx.create(ref.collection('rounds').doc(String(game.turn)), { ...result.result, resolvedAt: now, expiresAt: expires(now) });
        tx.set(ref, next);
        if (result.finished) tx.update(roomRef, { status: 'finished', updatedAt: now });
        else job(tx, gameId, next, now);
      }
      return { advanced: true, serverNow: now };
    });
  }
  return { saveProfile, roomCommand, submitIntent, advance };
}
