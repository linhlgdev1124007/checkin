import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { CheckinService } from '../../src/server/application/checkin-service.js';
import { MemoryStateRepository } from '../../src/server/data/state-repository.js';
import { Vault } from '../../src/server/security/vault.js';

describe('Express API', () => {
  it('exposes health and the setup/login lifecycle below /api', async () => {
    const app = createApp(new CheckinService(new MemoryStateRepository(), new Vault('api-boot')), { secureCookies: false });
    await request(app).get('/api/health').expect(200, { ok: true });
    await request(app).get('/api/system/status').expect(200, { state: 'uninitialized' });

    const setup = await request(app).post('/api/setup').set('Origin', 'http://localhost').send({ name: 'Admin' }).expect(201);
    expect(setup.body.key).toMatch(/^ck_/);
    expect(setup.headers['set-cookie'][0]).toContain('checkin_session=');
  });

  it('rejects state changes from a foreign origin', async () => {
    const app = createApp(new CheckinService(new MemoryStateRepository(), new Vault('api-boot')), { secureCookies: false });
    const response = await request(app).post('/api/setup').set('Origin', 'https://evil.example').set('Host', 'localhost').send({ name: 'Admin' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_ORIGIN');
  });

  it('rejects a malformed Origin header as a forbidden request', async () => {
    const app = createApp(new CheckinService(new MemoryStateRepository(), new Vault('api-boot')), { secureCookies: false });
    const response = await request(app).post('/api/setup').set('Origin', 'not a url').send({ name: 'Admin' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_ORIGIN');
  });

  it('accepts backup request bodies above the normal API limit for validation', async () => {
    const app = createApp(new CheckinService(new MemoryStateRepository(), new Vault('api-boot')), { secureCookies: false });
    const response = await request(app)
      .post('/api/restore')
      .set('Origin', 'http://localhost')
      .send({ key: 'invalid', backup: 'x'.repeat(1_100_000) });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_BACKUP');
  });
});
