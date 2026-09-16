import { writeFile } from 'node:fs/promises';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId || !process.env.FIREBASE_WEB_CONFIG) throw new Error('Configurá FIREBASE_PROJECT_ID y FIREBASE_WEB_CONFIG en las variables de GitHub.');
const config = JSON.parse(process.env.FIREBASE_WEB_CONFIG);
if ('private_key' in config || 'client_email' in config) throw new Error('Usá la configuración pública de Web App, no una cuenta de servicio.');
if (config.projectId !== projectId) throw new Error('El projectId de Web App debe coincidir con FIREBASE_PROJECT_ID.');
const fields = { apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID', appId: 'APP_ID', messagingSenderId: 'MESSAGING_SENDER_ID' };
const lines = [];
for (const [key, suffix] of Object.entries(fields)) {
  if (!config[key] && key !== 'messagingSenderId') throw new Error(`Falta ${key} en FIREBASE_WEB_CONFIG.`);
  if (config[key]) {
    if (!/^[A-Za-z0-9._:/-]+$/.test(config[key])) throw new Error(`Valor inválido: ${key}`);
    lines.push(`VITE_FIREBASE_${suffix}=${config[key]}`);
  }
}
lines.push('VITE_USE_EMULATORS=false');
await writeFile('.env.production', `${lines.join('\n')}\n`);
console.log('Configuración pública validada.');
