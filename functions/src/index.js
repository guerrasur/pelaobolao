import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { createService } from './service.js';
import { GameError, exactObject } from './game.js';

initializeApp();
const db = getFirestore();
const service = createService(db);
const region = 'us-central1';
setGlobalOptions({ region, maxInstances: 10, memory: '256MiB', timeoutSeconds: 30 });
const callable = handler => onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Reconectando tu identidad. Recargá si el problema continúa.');
  try { return await handler(request.auth.uid, request.data); }
  catch (error) {
    if (error instanceof GameError) throw new HttpsError(error.code, error.message);
    console.error('Request failed', error);
    throw new HttpsError('internal', 'No se pudo completar. Reintentá.');
  }
});
export const saveProfile = callable(service.saveProfile);
export const roomCommand = callable(service.roomCommand);
export const submitIntent = callable(service.submitIntent);
export const advanceGame = callable((uid, data) => {
  exactObject(data, ['gameId']);
  return service.advance(data.gameId, null, uid);
});

// Transactional outbox: the job survives a process crash after the game commit.
export const dispatchJob = onDocumentCreated({ document: 'jobs/{jobId}', retry: true }, async event => {
  const job = event.data?.data();
  if (!job) return;
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    // Emulator-only scheduler. Production always uses durable Cloud Tasks.
    setTimeout(() => service.advance(job.gameId, job).catch(console.error), Math.max(0, job.runAt - Date.now()));
    return;
  }
  await getFunctions().taskQueue(`locations/${region}/functions/turnTask`).enqueue(
    { gameId: job.gameId, turn: job.turn, phase: job.phase },
    { scheduleTime: new Date(Math.max(Date.now(), job.runAt)), dispatchDeadlineSeconds: 60 },
  );
});

export const turnTask = onTaskDispatched({
  retryConfig: { maxAttempts: 20, minBackoffSeconds: 1, maxBackoffSeconds: 30 },
  rateLimits: { maxConcurrentDispatches: 20 },
}, async request => {
  const result = await service.advance(request.data.gameId, request.data);
  // Never acknowledge an early task as complete. Retry until its authoritative deadline.
  if (result.due) throw new Error('Task arrived before deadline');
});
