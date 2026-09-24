export interface TelegramMessageEntity {
  type: 'mention' | 'text_mention' | string;
  offset: number;
  length: number;
  user?: { id: number; is_bot: boolean; username?: string };
}

export interface ParsedWitnessedCheckIn {
  witness: { userId?: string; username?: string };
  requestedAt: string;
  expiresAt: string;
}

const TWELVE_HOURS = 12 * 60 * 60 * 1_000;

export function parseWitnessedCheckIn(input: {
  text: string;
  entities: TelegramMessageEntity[];
  now: Date;
}): ParsedWitnessedCheckIn | null {
  const text = input.text.trim();
  if (/^\/in(?:@[A-Za-z0-9_]+)?$/i.test(text)) return null;
  if (!/^\/in(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return null;

  const prefix = /^\/in(?:@[A-Za-z0-9_]+)?\s+/i.exec(text);
  if (!prefix) throw new Error('INVALID_WITNESSED_CHECKIN');
  const argumentsMatch = /^(.+?)\s+(\d{2}):(\d{2})(?:\s+(\d{2})\/(\d{2})\/(\d{4}))?$/.exec(text.slice(prefix[0].length));
  if (!argumentsMatch) throw new Error('INVALID_WITNESSED_CHECKIN');

  const witnessText = argumentsMatch[1];
  const witnessOffset = prefix[0].length;
  const entity = input.entities.find((candidate) => candidate.offset === witnessOffset && candidate.length === witnessText.length);
  const witness = resolveWitness(witnessText, entity);

  const hour = Number(argumentsMatch[2]);
  const minute = Number(argumentsMatch[3]);
  if (hour > 23 || minute > 59) throw new Error('INVALID_WITNESSED_CHECKIN');
  const currentVietnam = new Date(input.now.getTime() + 7 * 60 * 60 * 1_000);
  const day = argumentsMatch[4] ? Number(argumentsMatch[4]) : currentVietnam.getUTCDate();
  const month = argumentsMatch[5] ? Number(argumentsMatch[5]) : currentVietnam.getUTCMonth() + 1;
  const year = argumentsMatch[6] ? Number(argumentsMatch[6]) : currentVietnam.getUTCFullYear();
  const requestedMilliseconds = Date.UTC(year, month - 1, day, hour - 7, minute);
  const roundTrip = new Date(requestedMilliseconds + 7 * 60 * 60 * 1_000);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() + 1 !== month || roundTrip.getUTCDate() !== day || roundTrip.getUTCHours() !== hour || roundTrip.getUTCMinutes() !== minute) {
    throw new Error('INVALID_WITNESSED_CHECKIN');
  }
  if (requestedMilliseconds > input.now.getTime()) throw new Error('ATTENDANCE_IN_FUTURE');
  if (input.now.getTime() - requestedMilliseconds > TWELVE_HOURS) throw new Error('ATTENDANCE_TOO_OLD');

  return {
    witness,
    requestedAt: new Date(requestedMilliseconds).toISOString(),
    expiresAt: new Date(input.now.getTime() + TWELVE_HOURS).toISOString(),
  };
}

function resolveWitness(text: string, entity: TelegramMessageEntity | undefined): ParsedWitnessedCheckIn['witness'] {
  if (entity?.type === 'mention' && /^@[A-Za-z0-9_]{5,32}$/.test(text)) return { username: text.slice(1).toLowerCase() };
  if (entity?.type === 'text_mention' && entity.user && !entity.user.is_bot && Number.isSafeInteger(entity.user.id)) return { userId: String(entity.user.id) };
  throw new Error('INVALID_WITNESSED_CHECKIN');
}
