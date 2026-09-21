import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
const encoded = (await readFile(new URL('assets/pwa/icon-192.b64', root), 'utf8')).trim();
const bytes = Buffer.from(encoded, 'base64');
if (bytes.length < 1000 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
  throw new Error('Ícono PWA inválido');
}
await writeFile(new URL('public/icon-192.png', root), bytes);
