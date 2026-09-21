import { describe, expect, it } from 'vitest';
import { applyAttendanceEvents, formatDuration } from '../../src/server/domain/attendance.js';

describe('attendance projection', () => {
  it('builds completed total and leaves the current session separate', () => {
    const projection = applyAttendanceEvents([
      { type: 'CHECKED_IN', sessionId: 'a', at: '2026-09-20T00:00:00.000Z' },
      { type: 'CHECKED_OUT', sessionId: 'a', at: '2026-09-20T02:30:00.000Z' },
      { type: 'CHECKED_IN', sessionId: 'b', at: '2026-09-21T00:00:00.000Z' },
    ]);
    expect(projection.completedMilliseconds).toBe(9_000_000);
    expect(projection.openSession?.sessionId).toBe('b');
  });

  it('applies a correction without discarding the original event', () => {
    const events = [
      { type: 'CHECKED_IN' as const, sessionId: 'a', at: '2026-09-20T00:00:00.000Z' },
      { type: 'CHECKED_OUT' as const, sessionId: 'a', at: '2026-09-20T01:00:00.000Z' },
      { type: 'ATTENDANCE_CORRECTED' as const, sessionId: 'a', startAt: '2026-09-20T00:15:00.000Z', endAt: '2026-09-20T01:45:00.000Z', reason: 'Máy chấm công sai' },
    ];
    expect(applyAttendanceEvents(events).completedMilliseconds).toBe(5_400_000);
    expect(events).toHaveLength(3);
  });

  it('rejects a correction ending before it starts', () => {
    expect(() => applyAttendanceEvents([
      { type: 'CHECKED_IN', sessionId: 'a', at: '2026-09-20T01:00:00.000Z' },
      { type: 'ATTENDANCE_CORRECTED', sessionId: 'a', startAt: '2026-09-20T02:00:00.000Z', endAt: '2026-09-20T01:00:00.000Z', reason: 'invalid' },
    ])).toThrow('INVALID_ATTENDANCE_RANGE');
  });

  it('adds signed administrative adjustments to completed time', () => {
    const projection = applyAttendanceEvents([
      { type: 'CHECKED_IN', sessionId: 'a', at: '2026-09-20T00:00:00.000Z' },
      { type: 'CHECKED_OUT', sessionId: 'a', at: '2026-09-20T01:00:00.000Z' },
      { type: 'ATTENDANCE_ADJUSTED', adjustmentMilliseconds: 1_800_000, reason: 'Bổ sung họp' },
      { type: 'ATTENDANCE_ADJUSTED', adjustmentMilliseconds: -600_000, reason: 'Trừ thời gian nghỉ' },
    ]);
    expect(projection.completedMilliseconds).toBe(4_800_000);
  });

  it('rejects adjustments that make completed time negative', () => {
    expect(() => applyAttendanceEvents([
      { type: 'ATTENDANCE_ADJUSTED', adjustmentMilliseconds: -60_000, reason: 'Không hợp lệ' },
    ])).toThrow('NEGATIVE_ATTENDANCE_TOTAL');
  });
});

describe('duration formatting', () => {
  it.each([
    [0, '0 giờ 0 phút'],
    [9_000_000, '2 giờ 30 phút'],
    [93_900_000, '1 ngày 2 giờ 5 phút'],
  ])('formats %d milliseconds', (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });
});
