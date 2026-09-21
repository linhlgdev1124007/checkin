import { randomBytes } from 'node:crypto';

const KEY_PATTERN = /^ck_([A-Za-z0-9-]{10})_([A-Za-z0-9_-]{43})$/;

export interface LoginKeyParts {
  publicId: string;
  secret: string;
}

export function generateLoginKey(): LoginKeyParts & { key: string } {
  const publicId = randomBytes(5).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { publicId, secret, key: `ck_${publicId}_${secret}` };
}

export function parseLoginKey(value: string): LoginKeyParts | null {
  const match = KEY_PATTERN.exec(value.trim());
  return match ? { publicId: match[1], secret: match[2] } : null;
}
