export type AttendanceEvent =
  | { type: 'CHECKED_IN'; sessionId: string; at: string }
  | { type: 'CHECKED_OUT'; sessionId: string; at: string }
  | { type: 'ATTENDANCE_CORRECTED'; sessionId: string; startAt: string; endAt: string | null; reason: string }
  | { type: 'ATTENDANCE_ADJUSTED'; adjustmentMilliseconds: number; reason: string };

export interface AttendanceSession {
  sessionId: string;
  originalStartAt: string;
  originalEndAt: string | null;
  effectiveStartAt: string;
  effectiveEndAt: string | null;
}

export interface AttendanceProjection {
  sessions: AttendanceSession[];
  completedMilliseconds: number;
  openSession: AttendanceSession | null;
}

export function applyAttendanceEvents(events: AttendanceEvent[]): AttendanceProjection {
  const sessions = new Map<string, AttendanceSession>();
  let adjustmentMilliseconds = 0;

  for (const event of events) {
    if (event.type === 'ATTENDANCE_ADJUSTED') {
      if (!Number.isSafeInteger(event.adjustmentMilliseconds) || event.adjustmentMilliseconds === 0) {
        throw new Error('INVALID_ATTENDANCE_ADJUSTMENT');
      }
      adjustmentMilliseconds += event.adjustmentMilliseconds;
      continue;
    }
    if (event.type === 'CHECKED_IN') {
      if ([...sessions.values()].some((session) => session.effectiveEndAt === null)) {
        throw new Error('ALREADY_CHECKED_IN');
      }
      sessions.set(event.sessionId, {
        sessionId: event.sessionId,
        originalStartAt: event.at,
        originalEndAt: null,
        effectiveStartAt: event.at,
        effectiveEndAt: null,
      });
      continue;
    }

    const session = sessions.get(event.sessionId);
    if (!session) throw new Error('ATTENDANCE_SESSION_NOT_FOUND');

    if (event.type === 'CHECKED_OUT') {
      if (session.effectiveEndAt !== null) throw new Error('ALREADY_CHECKED_OUT');
      if (session.originalEndAt === null) session.originalEndAt = event.at;
      session.effectiveEndAt = event.at;
    } else {
      session.effectiveStartAt = event.startAt;
      session.effectiveEndAt = event.endAt;
    }

    validateRange(session.effectiveStartAt, session.effectiveEndAt);
  }

  const values = [...sessions.values()];
  validateNoOverlap(values);
  const completedMilliseconds = values.reduce((total, session) => {
    if (!session.effectiveEndAt) return total;
    return total + Date.parse(session.effectiveEndAt) - Date.parse(session.effectiveStartAt);
  }, adjustmentMilliseconds);
  if (completedMilliseconds < 0) throw new Error('NEGATIVE_ATTENDANCE_TOTAL');
  return {
    sessions: values,
    completedMilliseconds,
    openSession: values.find((session) => session.effectiveEndAt === null) ?? null,
  };
}

function validateRange(startAt: string, endAt: string | null): void {
  const start = Date.parse(startAt);
  const end = endAt ? Date.parse(endAt) : null;
  if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end <= start))) {
    throw new Error('INVALID_ATTENDANCE_RANGE');
  }
}

function validateNoOverlap(sessions: AttendanceSession[]): void {
  const sorted = [...sessions].sort((a, b) => Date.parse(a.effectiveStartAt) - Date.parse(b.effectiveStartAt));
  for (let index = 1; index < sorted.length; index += 1) {
    const previousEnd = sorted[index - 1].effectiveEndAt;
    if (previousEnd === null || Date.parse(previousEnd) > Date.parse(sorted[index].effectiveStartAt)) {
      throw new Error('ATTENDANCE_OVERLAP');
    }
  }
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0
    ? `${days} ngày ${hours} giờ ${minutes} phút`
    : `${hours} giờ ${minutes} phút`;
}
