import { describe, expect, it } from 'vitest';
import { generateLoginKey, parseLoginKey } from '../../src/server/security/login-key.js';

describe('login keys', () => {
  it('round-trips a generated locator and secret', () => {
    const generated = generateLoginKey();
    expect(generated.key).toMatch(/^ck_[A-Za-z0-9-]{10}_[A-Za-z0-9_-]{43}$/);
    expect(parseLoginKey(generated.key)).toEqual({ publicId: generated.publicId, secret: generated.secret });
  });

  it.each(['', 'hello', 'ck_short_secret', 'ck_abcdefghij_***'])('rejects malformed key %j', (value) => {
    expect(parseLoginKey(value)).toBeNull();
  });
});

