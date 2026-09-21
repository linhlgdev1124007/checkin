import type { SealedValue } from '../security/crypto.js';

export type Role = 'admin' | 'member';

export interface AccountRecord {
  id: string;
  publicId: string;
  secretHash: string;
  role: Role;
  active: boolean;
  profile: SealedValue;
  securityTag: string;
  createdAt: string;
}

export interface EventRecord {
  id: string;
  sequence: number;
  accountId: string;
  actorId: string;
  type: string;
  payload: SealedValue;
  previousHash: string | null;
  hash: string;
  createdAt: string;
}

export interface SessionRecord {
  tokenHash: string;
  accountId: string;
  credentialPublicId: string;
  bootId: string;
  expiresAt: string;
}

export interface OutboxRecord {
  id: string;
  eventId: string;
  message: SealedValue;
  status: 'pending' | 'sending' | 'sent';
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  sentAt: string | null;
}

export interface StateDocument {
  schemaVersion: 1;
  system: {
    initializedAt: string;
    adminAccountId: string;
    wrapSalt: string;
    wrappedDataKey: SealedValue;
    tailHash: string | null;
    telegramSettings?: SealedValue;
  };
  accounts: AccountRecord[];
  events: EventRecord[];
  sessions: SessionRecord[];
  outbox: OutboxRecord[];
}
