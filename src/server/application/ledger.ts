import { createHmac, randomUUID } from 'node:crypto';
import type { StateDocument, EventRecord } from '../data/state-types.js';
import { decryptJson, encryptJson, hmacEvent } from '../security/crypto.js';

function integrityKey(dataKey: Buffer): Buffer {
  return createHmac('sha256', dataKey).update('checkin:event-integrity:v1').digest();
}

function eventMaterial(event: Omit<EventRecord, 'hash'>): string {
  return JSON.stringify([
    event.id,
    event.sequence,
    event.accountId,
    event.actorId,
    event.type,
    event.payload.nonce,
    event.payload.ciphertext,
    event.payload.tag,
    event.createdAt,
  ]);
}

export function appendEvent(
  state: StateDocument,
  dataKey: Buffer,
  accountId: string,
  actorId: string,
  type: string,
  payload: unknown,
  now: Date,
): EventRecord {
  const id = randomUUID();
  const sequence = state.events.length + 1;
  const base: Omit<EventRecord, 'hash'> = {
    id,
    sequence,
    accountId,
    actorId,
    type,
    payload: encryptJson(dataKey, payload, `event:${id}:${type}:v1`),
    previousHash: state.system.tailHash,
    createdAt: now.toISOString(),
  };
  const event = { ...base, hash: hmacEvent(integrityKey(dataKey), base.previousHash, eventMaterial(base)) };
  state.events.push(event);
  state.system.tailHash = event.hash;
  return event;
}

export function decryptEvent<T>(dataKey: Buffer, event: EventRecord): T {
  return decryptJson<T>(dataKey, event.payload, `event:${event.id}:${event.type}:v1`);
}

export function verifyLedger(state: StateDocument, dataKey: Buffer): void {
  let previous: string | null = null;
  for (let index = 0; index < state.events.length; index += 1) {
    const event = state.events[index];
    if (event.sequence !== index + 1 || event.previousHash !== previous) throw new Error('INVALID_LEDGER');
    const { hash: _hash, ...base } = event;
    const expected = hmacEvent(integrityKey(dataKey), previous, eventMaterial(base));
    if (event.hash !== expected) throw new Error('INVALID_LEDGER');
    decryptEvent(dataKey, event);
    previous = event.hash;
  }
  if (state.system.tailHash !== previous) throw new Error('INVALID_LEDGER');
}

