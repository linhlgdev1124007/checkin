import { describe, expect, it } from 'vitest';
import { CheckinService } from '../../src/server/application/checkin-service.js';
import { MemoryStateRepository } from '../../src/server/data/state-repository.js';
import { TelegramWorker } from '../../src/server/integrations/telegram-worker.js';
import { Vault } from '../../src/server/security/vault.js';

describe('TelegramWorker', () => {
  it('marks a delivered outbox item sent without exposing the message in storage', async () => {
    const repository = new MemoryStateRepository();
    const service = new CheckinService(repository, new Vault('telegram-boot'));
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    await service.checkIn(actor, new Date('2026-09-20T00:00:00.000Z'));
    const delivered: string[] = [];
    const worker = new TelegramWorker(service, async (text) => { delivered.push(text); });

    expect(await worker.deliverOnce(new Date('2026-09-20T00:00:01.000Z'))).toBe(true);
    expect(delivered).toEqual(['Admin • IN • Tổng online: 0 giờ 0 phút']);
    expect((await repository.read())?.outbox[0].status).toBe('sent');
    expect(JSON.stringify(await repository.read())).not.toContain(delivered[0]);
  });

  it('keeps a failed item pending and schedules a retry', async () => {
    const repository = new MemoryStateRepository();
    const service = new CheckinService(repository, new Vault('telegram-boot'));
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    await service.checkIn(actor, new Date('2026-09-20T00:00:00.000Z'));
    const worker = new TelegramWorker(service, async () => { throw new Error('Telegram unavailable'); });

    expect(await worker.deliverOnce(new Date('2026-09-20T00:00:01.000Z'))).toBe(true);
    const item = (await repository.read())?.outbox[0];
    expect(item).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Telegram unavailable' });
    expect(item && Date.parse(item.nextAttemptAt)).toBe(new Date('2026-09-20T00:00:06.000Z').getTime());
  });

  it('retries only the database acknowledgement after Telegram already succeeded', async () => {
    let sends = 0;
    let acknowledgements = 0;
    let offered = false;
    const service = {
      takeDueOutbox: async () => offered ? null : (offered = true, { id: 'message-1', text: 'hello', replyToMessageId: 44 }),
      finishOutbox: async () => { acknowledgements += 1; if (acknowledgements === 1) throw new Error('database unavailable'); },
    };
    const errors: string[] = [];
    let replyToMessageId: number | undefined;
    const worker = new TelegramWorker(service, async (_text, replyTo) => { sends += 1; replyToMessageId = replyTo; }, (error) => errors.push(error.message));

    expect(await worker.deliverOnce()).toBe(true);
    expect(await worker.deliverOnce()).toBe(true);
    expect(sends).toBe(1);
    expect(replyToMessageId).toBe(44);
    expect(acknowledgements).toBe(2);
    expect(errors).toEqual(['database unavailable']);
  });

  it('contains outbox read failures instead of rejecting the worker tick', async () => {
    const service = {
      takeDueOutbox: async () => { throw new Error('database unavailable'); },
      finishOutbox: async () => undefined,
    };
    const errors: string[] = [];
    const worker = new TelegramWorker(service, async () => undefined, (error) => errors.push(error.message));
    await expect(worker.deliverOnce()).resolves.toBe(false);
    expect(errors).toEqual(['database unavailable']);
  });
});
