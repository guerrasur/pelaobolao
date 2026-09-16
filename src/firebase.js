import { initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { createClient } from './client.js';

const emulator = import.meta.env.VITE_USE_EMULATORS === 'true';
const config = emulator ? {
  apiKey: 'demo-key', authDomain: 'demo-pelaobolao.firebaseapp.com', projectId: 'demo-pelaobolao', appId: 'demo-app',
} : {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
export async function connect() {
  if (!config.apiKey || !config.projectId || !config.appId || !config.authDomain) {
    throw new Error('Falta configurar la Web App de Firebase. Consultá la sección de publicación del README.');
  }
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulator) {
    const host = location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
  }
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  const client = createClient(db, uid);
  await client.syncClock();
  return { db, uid, ...client };
}
