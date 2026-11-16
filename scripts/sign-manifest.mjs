// Подпись манифеста релиза: node scripts/sign-manifest.mjs <manifest.json>
// Каноническая форма: JSON с отсортированными ключами, без пробелов, без поля signature.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

export function canonicalJson(manifest) {
  const rest = { ...manifest };
  delete rest.signature;
  return JSON.stringify(canonicalize(rest));
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/sign-manifest.mjs <manifest.json>');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const privateKey = createPrivateKey(
  readFileSync(new URL('../ops/keys/release-ed25519.private.pem', import.meta.url)),
);
const payload = Buffer.from(canonicalJson(manifest), 'utf8');
manifest.signature = sign(null, payload, privateKey).toString('base64');
writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`signed ${file}`);
