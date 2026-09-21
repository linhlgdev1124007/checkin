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

  it('exposes admin time adjustment and Telegram template endpoints', async () => {
    const app = createApp(new CheckinService(new MemoryStateRepository(), new Vault('api-admin')), { secureCookies: false });
    const agent = request.agent(app);
    await agent.post('/api/setup').set('Origin', 'http://localhost').send({ name: 'Admin' }).expect(201);
    const created = await agent.post('/api/accounts').set('Origin', 'http://localhost').send({ name: 'Nguyễn An' }).expect(201);

    await agent.post(`/api/admin/attendance/${created.body.account.id}/adjustments`)
      .set('Origin', 'http://localhost')
      .send({ adjustmentMilliseconds: 1_800_000, reason: 'Bổ sung họp' })
      .expect(201, { ok: true });
    const templates = await agent.get('/api/admin/telegram/templates').expect(200);
    await agent.put('/api/admin/telegram/templates')
      .set('Origin', 'http://localhost')
      .send({ ...templates.body.templates, checkIn: '{name} đã {action}: {duration}' })
      .expect(204);
    await agent.delete(`/api/accounts/${created.body.account.id}/telegram`).set('Origin', 'http://localhost').expect(204);

    const dashboard = await agent.get('/api/dashboard').expect(200);
    expect(dashboard.body.members.find((member: { id: string }) => member.id === created.body.account.id).completedMilliseconds).toBe(1_800_000);
  });
});
