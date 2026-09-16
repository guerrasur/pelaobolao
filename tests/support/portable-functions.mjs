// Test-only HTTP transport for environments without Unix domain sockets.
// Runs the production callable handlers against real Auth/Firestore emulators.
// CI uses the official Functions emulator instead (npm run test:e2e).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Only run with emulators.');
process.env.GCLOUD_PROJECT = 'demo-pelaobolao';
process.env.FUNCTIONS_EMULATOR = 'true';
const handlers = await import('../../functions/src/index.js');
const allowed = new Set(['saveProfile', 'roomCommand', 'submitIntent', 'advanceGame']);
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Firebase-Instance-ID-Token, X-Firebase-AppCheck');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  const name = request.url.split('/').at(-1);
  if (!allowed.has(name) || request.method !== 'POST') { response.writeHead(404); response.end(); return; }
  try {
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 4096) throw new Error('Payload too large'); }
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const decoded = token ? await getAuth().verifyIdToken(token) : null;
    const result = await handlers[name].run({ data: JSON.parse(body).data, auth: decoded ? { uid: decoded.uid, token: decoded } : undefined });
    response.end(JSON.stringify({ result }));
  } catch (error) {
    response.writeHead(400);
    response.end(JSON.stringify({ error: { status: (error.code ?? 'internal').replaceAll('-', '_').toUpperCase(), message: error.message } }));
  }
});
await new Promise(resolve => server.listen(5001, '127.0.0.1', resolve));
const unsubscribe = getFirestore().collection('jobs').onSnapshot(snapshot => {
  for (const change of snapshot.docChanges()) if (change.type === 'added') handlers.dispatchJob.run({ data: change.doc }).catch(console.error);
});
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], { stdio: 'inherit', env: process.env });
const exitCode = await new Promise(resolve => child.once('exit', resolve));
unsubscribe(); server.close();
process.exit(exitCode ?? 1);
