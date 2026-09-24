import { describe, expect, it } from 'vitest';
import { projectTelegramCheckInRequests, type TelegramCheckInRequestEvent } from '../../src/server/domain/telegram-approval.js';

describe('projectTelegramCheckInRequests', () => {
  const requested: TelegramCheckInRequestEvent = {
    type: 'TELEGRAM_CHECKIN_REQUESTED', chatId: '-100', messageId: 40,
    requesterAccountId: 'requester', witnessAccountId: 'witness',
    requestedAt: '2026-09-24T01:00:00.000Z', expiresAt: '2026-09-24T14:00:00.000Z',
  };

  it('projects approvals and completion in either order', () => {
    const events: TelegramCheckInRequestEvent[] = [
      requested,
      { type: 'TELEGRAM_CHECKIN_ADMIN_APPROVED', chatId: '-100', messageId: 40, approverAccountId: 'admin' },
      { type: 'TELEGRAM_CHECKIN_WITNESS_APPROVED', chatId: '-100', messageId: 40, approverAccountId: 'witness' },
      { type: 'TELEGRAM_CHECKIN_COMPLETED', chatId: '-100', messageId: 40, sessionId: 'session' },
    ];
    expect(projectTelegramCheckInRequests(events).get('-100:40')).toMatchObject({
      witnessApprovedBy: 'witness', adminApprovedBy: 'admin', status: 'completed', sessionId: 'session',
    });
  });

  it('isolates chats and treats duplicate approvals idempotently', () => {
    const other = { ...requested, chatId: '-200' };
    const projection = projectTelegramCheckInRequests([
      requested, other,
      { type: 'TELEGRAM_CHECKIN_WITNESS_APPROVED', chatId: '-100', messageId: 40, approverAccountId: 'witness' },
      { type: 'TELEGRAM_CHECKIN_WITNESS_APPROVED', chatId: '-100', messageId: 40, approverAccountId: 'witness' },
    ]);
    expect(projection.get('-100:40')?.witnessApprovedBy).toBe('witness');
    expect(projection.get('-200:40')?.witnessApprovedBy).toBeNull();
  });

  it('projects expiration and rejects impossible histories', () => {
    expect(projectTelegramCheckInRequests([requested, { type: 'TELEGRAM_CHECKIN_EXPIRED', chatId: '-100', messageId: 40 }]).get('-100:40')?.status).toBe('expired');
    expect(() => projectTelegramCheckInRequests([{ type: 'TELEGRAM_CHECKIN_COMPLETED', chatId: '-100', messageId: 99, sessionId: 'missing' }])).toThrow('INVALID_TELEGRAM_APPROVAL_HISTORY');
  });
});
