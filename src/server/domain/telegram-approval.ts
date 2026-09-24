export type TelegramCheckInRequestEvent =
  | { type: 'TELEGRAM_CHECKIN_REQUESTED'; chatId: string; messageId: number; requesterAccountId: string; witnessAccountId: string; requestedAt: string; expiresAt: string }
  | { type: 'TELEGRAM_CHECKIN_WITNESS_APPROVED'; chatId: string; messageId: number; approverAccountId: string }
  | { type: 'TELEGRAM_CHECKIN_ADMIN_APPROVED'; chatId: string; messageId: number; approverAccountId: string }
  | { type: 'TELEGRAM_CHECKIN_COMPLETED'; chatId: string; messageId: number; sessionId: string }
  | { type: 'TELEGRAM_CHECKIN_EXPIRED'; chatId: string; messageId: number };

export interface TelegramCheckInRequestState {
  chatId: string;
  messageId: number;
  requesterAccountId: string;
  witnessAccountId: string;
  requestedAt: string;
  expiresAt: string;
  witnessApprovedBy: string | null;
  adminApprovedBy: string | null;
  status: 'pending' | 'completed' | 'expired';
  sessionId: string | null;
}

export function telegramRequestKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function projectTelegramCheckInRequests(events: TelegramCheckInRequestEvent[]): Map<string, TelegramCheckInRequestState> {
  const requests = new Map<string, TelegramCheckInRequestState>();
  for (const event of events) {
    const key = telegramRequestKey(event.chatId, event.messageId);
    if (event.type === 'TELEGRAM_CHECKIN_REQUESTED') {
      if (requests.has(key)) throw new Error('INVALID_TELEGRAM_APPROVAL_HISTORY');
      requests.set(key, {
        chatId: event.chatId, messageId: event.messageId,
        requesterAccountId: event.requesterAccountId, witnessAccountId: event.witnessAccountId,
        requestedAt: event.requestedAt, expiresAt: event.expiresAt,
        witnessApprovedBy: null, adminApprovedBy: null, status: 'pending', sessionId: null,
      });
      continue;
    }
    const request = requests.get(key);
    if (!request || request.status !== 'pending') throw new Error('INVALID_TELEGRAM_APPROVAL_HISTORY');
    if (event.type === 'TELEGRAM_CHECKIN_WITNESS_APPROVED') {
      if (request.witnessApprovedBy && request.witnessApprovedBy !== event.approverAccountId) throw new Error('INVALID_TELEGRAM_APPROVAL_HISTORY');
      request.witnessApprovedBy = event.approverAccountId;
    } else if (event.type === 'TELEGRAM_CHECKIN_ADMIN_APPROVED') {
      if (request.adminApprovedBy && request.adminApprovedBy !== event.approverAccountId) throw new Error('INVALID_TELEGRAM_APPROVAL_HISTORY');
      request.adminApprovedBy = event.approverAccountId;
    } else if (event.type === 'TELEGRAM_CHECKIN_COMPLETED') {
      if (!request.witnessApprovedBy || !request.adminApprovedBy) throw new Error('INVALID_TELEGRAM_APPROVAL_HISTORY');
      request.status = 'completed';
      request.sessionId = event.sessionId;
    } else {
      request.status = 'expired';
    }
  }
  return requests;
}
