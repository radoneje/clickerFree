// Генерация ключа подписи манифестов релизов (ed25519).
// Приватный ключ остаётся вне Git; публичный встраивается в воркеры.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const dir = new URL('../ops/keys/', import.meta.url);
const privatePath = new URL('release-ed25519.private.pem', dir);
const publicPath = new URL('release-ed25519.public.pem', dir);

if (existsSync(privatePath)) {
  console.error('Private key already exists — refusing to overwrite.');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Keys written to ops/keys/. Private key is gitignored — keep it secret.');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
