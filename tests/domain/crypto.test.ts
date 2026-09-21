import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptJson, deriveKey, encryptJson, hmacEvent } from '../../src/server/security/crypto.js';

describe('authenticated encryption', () => {
  it('decrypts only with the matching key and AAD', async () => {
    const key = randomBytes(32);
    const sealed = encryptJson(key, { name: 'An' }, 'account:123:v1');
    expect(decryptJson(key, sealed, 'account:123:v1')).toEqual({ name: 'An' });
    expect(() => decryptJson(key, sealed, 'account:456:v1')).toThrow();
  });

  it('detects modified ciphertext', () => {
    const key = randomBytes(32);
    const sealed = encryptJson(key, { seconds: 42 }, 'event:1:v1');
    const bytes = Buffer.from(sealed.ciphertext, 'base64url');
    bytes[0] ^= 1;
    expect(() => decryptJson(key, { ...sealed, ciphertext: bytes.toString('base64url') }, 'event:1:v1')).toThrow();
  });

  it('derives deterministic independent keys and chains events', async () => {
    const salt = Buffer.alloc(16, 7);
    const first = await deriveKey('admin-key', salt, 'wrap');
    const again = await deriveKey('admin-key', salt, 'wrap');
    const backup = await deriveKey('admin-key', salt, 'backup');
    expect(first.equals(again)).toBe(true);
    expect(first.equals(backup)).toBe(false);
    expect(hmacEvent(first, null, 'payload')).not.toBe(hmacEvent(first, null, 'other'));
  });
});

