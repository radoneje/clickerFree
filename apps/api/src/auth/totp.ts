import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(totpCode(secret, counter + offset));
    const actual = Buffer.from(code);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string): string {
  return `otpauth://totp/ClickerFree:${encodeURIComponent(account)}?secret=${secret}&issuer=ClickerFree&algorithm=SHA1&digits=6&period=30`;
}
