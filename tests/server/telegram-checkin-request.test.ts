import { describe, expect, it } from 'vitest';
import { parseWitnessedCheckIn } from '../../src/server/domain/telegram-checkin-request.js';

describe('parseWitnessedCheckIn', () => {
  const mention = { type: 'mention', offset: 4, length: 8 };

  it('parses an explicit Vietnam date and a username mention', () => {
    expect(parseWitnessedCheckIn({
      text: '/in @witness 23:00 23/09/2026', entities: [mention], now: new Date('2026-09-23T17:00:00.000Z'),
    })).toEqual({
      witness: { username: 'witness' },
      requestedAt: '2026-09-23T16:00:00.000Z',
      expiresAt: '2026-09-24T05:00:00.000Z',
    });
  });

  it('uses the current Vietnam date when the date is omitted', () => {
    expect(parseWitnessedCheckIn({
      text: '/in @witness 00:15', entities: [mention], now: new Date('2026-09-23T17:30:00.000Z'),
    })?.requestedAt).toBe('2026-09-23T17:15:00.000Z');
  });

  it('accepts a text mention and the exact twelve-hour boundary', () => {
    expect(parseWitnessedCheckIn({
      text: '/in Hy 12:00 23/09/2026',
      entities: [{ type: 'text_mention', offset: 4, length: 2, user: { id: 88, is_bot: false } }],
      now: new Date('2026-09-23T17:00:00.000Z'),
    })?.witness).toEqual({ userId: '88' });
  });

  it('returns null for immediate in and rejects malformed or disallowed times', () => {
    expect(parseWitnessedCheckIn({ text: '/in', entities: [], now: new Date() })).toBeNull();
    expect(() => parseWitnessedCheckIn({ text: '/in @witness 11:59 23/09/2026', entities: [mention], now: new Date('2026-09-23T17:00:00.000Z') })).toThrow('ATTENDANCE_TOO_OLD');
    expect(() => parseWitnessedCheckIn({ text: '/in @witness 00:01 24/09/2026', entities: [mention], now: new Date('2026-09-23T17:00:00.000Z') })).toThrow('ATTENDANCE_IN_FUTURE');
    expect(() => parseWitnessedCheckIn({ text: '/in @witness 25:00', entities: [mention], now: new Date() })).toThrow('INVALID_WITNESSED_CHECKIN');
    expect(() => parseWitnessedCheckIn({ text: '/in @witness 10:00 31/02/2026', entities: [mention], now: new Date('2026-02-28T04:00:00.000Z') })).toThrow('INVALID_WITNESSED_CHECKIN');
    expect(() => parseWitnessedCheckIn({ text: '/in @witness 10:00 extra data', entities: [mention], now: new Date() })).toThrow('INVALID_WITNESSED_CHECKIN');
    expect(() => parseWitnessedCheckIn({ text: '/in @witness 10:00', entities: [], now: new Date() })).toThrow('INVALID_WITNESSED_CHECKIN');
  });
});
