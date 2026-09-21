import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

export interface SealedValue {
  nonce: string;
  ciphertext: string;
  tag: string;
}

export async function deriveKey(material: string, salt: Buffer, purpose: string): Promise<Buffer> {
  return argon2.hash(`${purpose}\0${material}`, {
    type: argon2.argon2id,
    salt,
    hashLength: 32,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    raw: true,
  });
}

export function encryptBuffer(key: Buffer, value: Buffer, aad: string): SealedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptBuffer(key: Buffer, sealed: SealedValue, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64url')),
    decipher.final(),
  ]);
}

export function encryptJson(key: Buffer, value: unknown, aad: string): SealedValue {
  return encryptBuffer(key, Buffer.from(JSON.stringify(value)), aad);
}

export function decryptJson<T>(key: Buffer, sealed: SealedValue, aad: string): T {
  return JSON.parse(decryptBuffer(key, sealed, aad).toString('utf8')) as T;
}

export function hmacEvent(key: Buffer, previousHash: string | null, payload: string): string {
  return createHmac('sha256', key)
    .update(previousHash ?? 'GENESIS')
    .update('\0')
    .update(payload)
    .digest('base64url');
}

export function randomKey(): Buffer {
  return randomBytes(32);
}

