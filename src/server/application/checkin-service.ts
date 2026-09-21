import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { StateRepository } from '../data/state-repository.js';
import type { AccountRecord, Role, StateDocument } from '../data/state-types.js';
import { applyAttendanceEvents, formatDuration, type AttendanceEvent } from '../domain/attendance.js';
import { decryptBuffer, decryptJson, deriveKey, encryptBuffer, encryptJson, randomKey, type SealedValue } from '../security/crypto.js';
import { generateLoginKey, parseLoginKey } from '../security/login-key.js';
import { Vault } from '../security/vault.js';
import { appendEvent, decryptEvent, verifyLedger } from './ledger.js';

export interface Actor {
  id: string;
  role: Role;
  name: string;
}

interface AccountProfile { name: string }
interface AttendanceCorrection { startAt: string; endAt: string | null; reason: string }
interface BackupEnvelope { format: 'team-checkin-backup'; version: 1; salt: string; sealed: SealedValue }

const SESSION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export class CheckinService {
  constructor(private readonly repository: StateRepository, private readonly vault: Vault) {}

  async status(): Promise<{ state: 'uninitialized' | 'locked' | 'unlocked' }> {
    const document = await this.repository.read();
    return { state: !document ? 'uninitialized' : this.vault.unlocked ? 'unlocked' : 'locked' };
  }

  async setup(name: string): Promise<{ key: string; token: string; account: Actor }> {
    const normalizedName = validateName(name);
    const credential = generateLoginKey();
    const dataKey = randomKey();
    const accountId = randomUUID();
    const now = new Date();
    const wrapSalt = randomBytes(16);
    const wrappingKey = await deriveKey(credential.key, wrapSalt, 'wrap');
    const token = randomToken();
    const account: AccountRecord = {
      id: accountId,
      publicId: credential.publicId,
      secretHash: await hashSecret(credential.secret),
      role: 'admin',
      active: true,
      profile: encryptJson(dataKey, { name: normalizedName }, `account:${accountId}:v1`),
      securityTag: '',
      createdAt: now.toISOString(),
    };
    sealAccountIntegrity(dataKey, account);
    const document: StateDocument = {
      schemaVersion: 1,
      system: {
        initializedAt: now.toISOString(),
        adminAccountId: accountId,
        wrapSalt: wrapSalt.toString('base64url'),
        wrappedDataKey: encryptBuffer(wrappingKey, dataKey, 'system:dek:v1'),
        tailHash: null,
      },
      accounts: [account],
      events: [],
      sessions: [newSession(token, accountId, credential.publicId, this.vault.bootId, now)],
      outbox: [],
    };
    appendEvent(document, dataKey, accountId, accountId, 'ACCOUNT_CREATED', { role: 'admin', name: normalizedName }, now);
    if (!(await this.repository.initialize(document))) throw new Error('ALREADY_INITIALIZED');
    this.vault.unlock(dataKey);
    return { key: credential.key, token, account: { id: accountId, role: 'admin', name: normalizedName } };
  }

  async unlock(key: string): Promise<{ token: string; account: Actor }> {
    const document = await this.requireDocument();
    const admin = document.accounts.find((account) => account.id === document.system.adminAccountId);
    const parts = parseLoginKey(key);
    if (!admin || !parts || parts.publicId !== admin.publicId || !(await verifySecret(admin.secretHash, parts.secret))) {
      throw new Error('INVALID_KEY');
    }
    try {
      const wrappingKey = await deriveKey(key, Buffer.from(document.system.wrapSalt, 'base64url'), 'wrap');
      const dataKey = decryptBuffer(wrappingKey, document.system.wrappedDataKey, 'system:dek:v1');
      assertAccountIntegrity(dataKey, admin);
      const profile = decryptProfile(dataKey, admin);
      verifyLedger(document, dataKey);
      this.vault.unlock(dataKey);
      const token = await this.createSession(admin.id, admin.publicId);
      return { token, account: { id: admin.id, role: admin.role, name: profile.name } };
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_LEDGER') throw error;
      throw new Error('INVALID_KEY');
    }
  }

  async login(key: string): Promise<{ token: string; account: Actor }> {
    const dataKey = this.vault.requireKey();
    const parts = parseLoginKey(key);
    if (!parts) throw new Error('INVALID_KEY');
    const document = await this.requireDocument();
    const account = document.accounts.find((candidate) => candidate.publicId === parts.publicId);
    if (!account) throw new Error('INVALID_KEY');
    assertAccountIntegrity(dataKey, account);
    if (!account.active || !(await verifySecret(account.secretHash, parts.secret))) throw new Error('INVALID_KEY');
    const profile = decryptProfile(dataKey, account);
    const token = await this.createSession(account.id, account.publicId);
    return { token, account: { id: account.id, role: account.role, name: profile.name } };
  }

  async authenticate(token: string): Promise<Actor> {
    const dataKey = this.vault.requireKey();
    const document = await this.requireDocument();
    const now = Date.now();
    const session = document.sessions.find((candidate) =>
      candidate.tokenHash === hashToken(token)
      && candidate.bootId === this.vault.bootId
      && Date.parse(candidate.expiresAt) > now,
    );
    if (!session) throw new Error('UNAUTHORIZED');
    const account = document.accounts.find((candidate) => candidate.id === session.accountId);
    if (!account) throw new Error('UNAUTHORIZED');
    assertAccountIntegrity(dataKey, account);
    if (!account.active || session.credentialPublicId !== account.publicId) throw new Error('UNAUTHORIZED');
    return { id: account.id, role: account.role, name: decryptProfile(dataKey, account).name };
  }

  async logout(token: string): Promise<void> {
    await this.repository.mutate((state) => {
      state.sessions = state.sessions.filter((session) => session.tokenHash !== hashToken(token));
    });
  }

  async lock(actor: Actor): Promise<void> {
    requireAdmin(actor);
    await this.repository.mutate((state) => { state.sessions = []; });
    this.vault.lock();
  }

  async createAccount(actor: Actor, name: string): Promise<{ key: string; account: Actor & { active: boolean } }> {
    requireAdmin(actor);
    const normalizedName = validateName(name);
    const credential = generateLoginKey();
    const dataKey = this.vault.requireKey();
    const accountId = randomUUID();
    const secretHash = await hashSecret(credential.secret);
    return this.repository.mutate((state) => {
      const now = new Date();
      const account: AccountRecord = {
        id: accountId,
        publicId: credential.publicId,
        secretHash,
        role: 'member',
        active: true,
        profile: encryptJson(dataKey, { name: normalizedName }, `account:${accountId}:v1`),
        securityTag: '',
        createdAt: now.toISOString(),
      };
      sealAccountIntegrity(dataKey, account);
      state.accounts.push(account);
      appendEvent(state, dataKey, accountId, actor.id, 'ACCOUNT_CREATED', { role: 'member', name: normalizedName }, now);
      return { key: credential.key, account: { id: accountId, role: 'member' as const, name: normalizedName, active: true } };
    });
  }

  async updateAccount(actor: Actor, accountId: string, update: { name?: string; active?: boolean }): Promise<void> {
    requireAdmin(actor);
    const dataKey = this.vault.requireKey();
    await this.repository.mutate((state) => {
      const account = requireMember(state, dataKey, accountId);
      const previous = decryptProfile(dataKey, account);
      const name = update.name === undefined ? previous.name : validateName(update.name);
      if (update.name !== undefined) account.profile = encryptJson(dataKey, { name }, `account:${account.id}:v1`);
      if (update.active !== undefined) {
        account.active = update.active;
        if (!update.active) state.sessions = state.sessions.filter((session) => session.accountId !== account.id);
      }
      sealAccountIntegrity(dataKey, account);
      appendEvent(state, dataKey, account.id, actor.id, 'ACCOUNT_UPDATED', { name, active: account.active }, new Date());
    });
  }

  async rotateMemberKey(actor: Actor, accountId: string): Promise<{ key: string }> {
    requireAdmin(actor);
    const dataKey = this.vault.requireKey();
    const credential = generateLoginKey();
    const secretHash = await hashSecret(credential.secret);
    await this.repository.mutate((state) => {
      const account = requireMember(state, dataKey, accountId);
      account.publicId = credential.publicId;
      account.secretHash = secretHash;
      sealAccountIntegrity(dataKey, account);
      state.sessions = state.sessions.filter((session) => session.accountId !== account.id);
      appendEvent(state, dataKey, account.id, actor.id, 'CREDENTIAL_ROTATED', {}, new Date());
    });
    return { key: credential.key };
  }

  async listAccounts(actor: Actor): Promise<Array<Actor & { active: boolean; createdAt: string }>> {
    requireAdmin(actor);
    const key = this.vault.requireKey();
    const state = await this.requireDocument();
    return state.accounts.map((account) => {
      assertAccountIntegrity(key, account);
      return { id: account.id, role: account.role, name: decryptProfile(key, account).name, active: account.active, createdAt: account.createdAt };
    });
  }

  async checkIn(actor: Actor, now = new Date()): Promise<{ sessionId: string }> {
    return this.changeAttendance(actor, 'CHECKED_IN', now);
  }

  async checkOut(actor: Actor, now = new Date()): Promise<{ sessionId: string }> {
    return this.changeAttendance(actor, 'CHECKED_OUT', now);
  }

  private async changeAttendance(actor: Actor, type: 'CHECKED_IN' | 'CHECKED_OUT', now: Date): Promise<{ sessionId: string }> {
    const key = this.vault.requireKey();
    return this.repository.mutate((state) => {
      const account = state.accounts.find((candidate) => candidate.id === actor.id && candidate.active);
      if (!account) throw new Error('ACCOUNT_DISABLED');
      assertAccountIntegrity(key, account);
      const before = attendanceProjection(state, key, actor.id);
      if (type === 'CHECKED_IN' && before.openSession) throw new Error('ALREADY_CHECKED_IN');
      if (type === 'CHECKED_OUT' && !before.openSession) throw new Error('NOT_CHECKED_IN');
      const sessionId = before.openSession?.sessionId ?? randomUUID();
      const event = appendEvent(state, key, actor.id, actor.id, type, { sessionId, at: now.toISOString() }, now);
      const after = attendanceProjection(state, key, actor.id);
      const total = type === 'CHECKED_IN' ? before.completedMilliseconds : after.completedMilliseconds;
      const profile = decryptProfile(key, account);
      const message = `${profile.name} • ${type === 'CHECKED_IN' ? 'IN' : 'OUT'} • Tổng online: ${formatDuration(total)}`;
      const outboxId = randomUUID();
      state.outbox.push({
        id: outboxId,
        eventId: event.id,
        message: encryptJson(key, { text: message }, `outbox:${outboxId}:v1`),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now.toISOString(),
        lastError: null,
        sentAt: null,
      });
      return { sessionId };
    });
  }

  async correctAttendance(actor: Actor, accountId: string, sessionId: string, correction: AttendanceCorrection, now = new Date()): Promise<void> {
    requireAdmin(actor);
    if (!correction.reason.trim()) throw new Error('CORRECTION_REASON_REQUIRED');
    if (Date.parse(correction.startAt) > now.getTime() || (correction.endAt && Date.parse(correction.endAt) > now.getTime())) {
      throw new Error('ATTENDANCE_IN_FUTURE');
    }
    const key = this.vault.requireKey();
    await this.repository.mutate((state) => {
      requireAccount(state, accountId);
      appendEvent(state, key, accountId, actor.id, 'ATTENDANCE_CORRECTED', { sessionId, ...correction }, now);
      attendanceProjection(state, key, accountId);
    });
  }

  async dashboard(_actor: Actor, now = new Date()): Promise<{ now: string; members: Array<{ id: string; name: string; completedMilliseconds: number; isOnline: boolean; openSince: string | null }> }> {
    const key = this.vault.requireKey();
    const state = await this.requireDocument();
    const members = state.accounts.filter((account) => account.active).map((account) => {
      assertAccountIntegrity(key, account);
      const projection = attendanceProjection(state, key, account.id);
      return {
        id: account.id,
        name: decryptProfile(key, account).name,
        completedMilliseconds: projection.completedMilliseconds,
        isOnline: projection.openSession !== null,
        openSince: projection.openSession?.effectiveStartAt ?? null,
      };
    }).sort((a, b) => b.completedMilliseconds - a.completedMilliseconds || a.name.localeCompare(b.name, 'vi'));
    return { now: now.toISOString(), members };
  }

  async audit(actor: Actor): Promise<Array<{ id: string; type: string; accountId: string; actorId: string; createdAt: string; payload: unknown }>> {
    requireAdmin(actor);
    const key = this.vault.requireKey();
    const state = await this.requireDocument();
    verifyLedger(state, key);
    return [...state.events].reverse().map((event) => ({
      id: event.id,
      type: event.type,
      accountId: event.accountId,
      actorId: event.actorId,
      createdAt: event.createdAt,
      payload: decryptEvent(key, event),
    }));
  }

  async exportBackup(actor: Actor, adminKey: string): Promise<string> {
    requireAdmin(actor);
    const state = await this.requireDocument();
    await this.validateAdminKey(state, adminKey);
    const salt = randomBytes(16);
    const backupKey = await deriveKey(adminKey, salt, 'backup');
    const portable = structuredClone(state);
    portable.sessions = [];
    const envelope: BackupEnvelope = {
      format: 'team-checkin-backup',
      version: 1,
      salt: salt.toString('base64url'),
      sealed: encryptJson(backupKey, portable, 'team-checkin-backup:v1'),
    };
    return JSON.stringify(envelope);
  }

  async importBackup(actor: Actor, adminKey: string, contents: string): Promise<void> {
    requireAdmin(actor);
    await this.validateAdminKey(await this.requireDocument(), adminKey);
    const { document, dataKey } = await decodeBackup(adminKey, contents);
    await this.validateState(document, dataKey);
    document.sessions = [];
    await this.repository.replace(document);
    this.vault.unlock(dataKey);
  }

  async restoreIntoEmpty(adminKey: string, contents: string): Promise<void> {
    if (await this.repository.read()) throw new Error('ALREADY_INITIALIZED');
    const { document, dataKey } = await decodeBackup(adminKey, contents);
    await this.validateState(document, dataKey);
    document.sessions = [];
    if (!(await this.repository.initialize(document))) throw new Error('ALREADY_INITIALIZED');
    this.vault.unlock(dataKey);
  }

  async listOutbox(actor: Actor): Promise<Array<{ id: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null }>> {
    requireAdmin(actor);
    const state = await this.requireDocument();
    return state.outbox.map(({ id, status, attempts, nextAttemptAt, lastError }) => ({ id, status, attempts, nextAttemptAt, lastError }));
  }

  async takeDueOutbox(now = new Date()): Promise<{ id: string; text: string } | null> {
    if (!this.vault.unlocked) return null;
    const key = this.vault.requireKey();
    return this.repository.mutate((state) => {
      const item = state.outbox.find((candidate) => candidate.status === 'pending' && Date.parse(candidate.nextAttemptAt) <= now.getTime());
      if (!item) return null;
      item.status = 'sending';
      item.attempts += 1;
      return { id: item.id, text: decryptJson<{ text: string }>(key, item.message, `outbox:${item.id}:v1`).text };
    });
  }

  async finishOutbox(id: string, error: string | null, now = new Date()): Promise<void> {
    await this.repository.mutate((state) => {
      const item = state.outbox.find((candidate) => candidate.id === id);
      if (!item || item.status === 'sent') return;
      if (!error) {
        item.status = 'sent';
        item.sentAt = now.toISOString();
        item.lastError = null;
      } else {
        item.status = 'pending';
        item.lastError = error.slice(0, 500);
        const delay = Math.min(3_600_000, 5_000 * 2 ** Math.min(Math.max(0, item.attempts - 1), 10));
        item.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
      }
    });
  }

  async retryOutbox(actor: Actor, id: string): Promise<void> {
    requireAdmin(actor);
    await this.repository.mutate((state) => {
      const item = state.outbox.find((candidate) => candidate.id === id && candidate.status !== 'sent');
      if (!item) throw new Error('OUTBOX_NOT_FOUND');
      item.status = 'pending';
      item.nextAttemptAt = new Date().toISOString();
      item.lastError = null;
    });
  }

  private async createSession(accountId: string, expectedPublicId: string): Promise<string> {
    const token = randomToken();
    await this.repository.mutate((state) => {
      const now = new Date();
      const account = state.accounts.find((candidate) => candidate.id === accountId);
      if (!account || !account.active || account.publicId !== expectedPublicId) throw new Error('INVALID_KEY');
      assertAccountIntegrity(this.vault.requireKey(), account);
      state.sessions = state.sessions.filter((session) => Date.parse(session.expiresAt) > now.getTime());
      state.sessions.push(newSession(token, accountId, expectedPublicId, this.vault.bootId, now));
    });
    return token;
  }

  private async requireDocument(): Promise<StateDocument> {
    const document = await this.repository.read();
    if (!document) throw new Error('NOT_INITIALIZED');
    return document;
  }

  private async validateAdminKey(state: StateDocument, adminKey: string): Promise<Buffer> {
    const admin = state.accounts.find((account) => account.id === state.system.adminAccountId);
    const parts = parseLoginKey(adminKey);
    if (!admin || !parts || parts.publicId !== admin.publicId || !(await verifySecret(admin.secretHash, parts.secret))) throw new Error('INVALID_KEY');
    try {
      const wrappingKey = await deriveKey(adminKey, Buffer.from(state.system.wrapSalt, 'base64url'), 'wrap');
      const dataKey = decryptBuffer(wrappingKey, state.system.wrappedDataKey, 'system:dek:v1');
      assertAccountIntegrity(dataKey, admin);
      return dataKey;
    } catch {
      throw new Error('INVALID_KEY');
    }
  }

  private async validateState(state: StateDocument, dataKey: Buffer): Promise<void> {
    if (state.schemaVersion !== 1) throw new Error('INVALID_BACKUP');
    try {
      for (const account of state.accounts) {
        assertAccountIntegrity(dataKey, account);
        decryptProfile(dataKey, account);
      }
      if (state.accounts.filter((account) => account.role === 'admin').length !== 1) throw new Error('INVALID_BACKUP');
      verifyLedger(state, dataKey);
    } catch {
      throw new Error('INVALID_BACKUP');
    }
  }
}

function attendanceProjection(state: StateDocument, key: Buffer, accountId: string) {
  const attendanceTypes = new Set(['CHECKED_IN', 'CHECKED_OUT', 'ATTENDANCE_CORRECTED']);
  const events = state.events
    .filter((event) => event.accountId === accountId && attendanceTypes.has(event.type))
    .map((event) => ({ type: event.type, ...decryptEvent<Record<string, unknown>>(key, event) })) as AttendanceEvent[];
  return applyAttendanceEvents(events);
}

function decryptProfile(key: Buffer, account: AccountRecord): AccountProfile {
  return decryptJson<AccountProfile>(key, account.profile, `account:${account.id}:v1`);
}

function validateName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) throw new Error('INVALID_NAME');
  return normalized;
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new Error('FORBIDDEN');
}

function requireAccount(state: StateDocument, accountId: string): AccountRecord {
  const account = state.accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');
  return account;
}

function requireMember(state: StateDocument, key: Buffer, accountId: string): AccountRecord {
  const account = requireAccount(state, accountId);
  assertAccountIntegrity(key, account);
  if (account.role === 'admin') throw new Error('ADMIN_IMMUTABLE');
  return account;
}

async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try { return await argon2.verify(hash, secret); } catch { return false; }
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function newSession(token: string, accountId: string, credentialPublicId: string, bootId: string, now: Date) {
  return {
    tokenHash: hashToken(token),
    accountId,
    credentialPublicId,
    bootId,
    expiresAt: new Date(now.getTime() + SESSION_MILLISECONDS).toISOString(),
  };
}

function accountIntegrityTag(key: Buffer, account: AccountRecord): string {
  return createHmac('sha256', key).update('checkin:account-integrity:v1\0').update(JSON.stringify([
    account.id, account.publicId, account.secretHash, account.role, account.active,
    account.profile.nonce, account.profile.ciphertext, account.profile.tag, account.createdAt,
  ])).digest('base64url');
}

function sealAccountIntegrity(key: Buffer, account: AccountRecord): void {
  account.securityTag = accountIntegrityTag(key, account);
}

function assertAccountIntegrity(key: Buffer, account: AccountRecord): void {
  const actual = Buffer.from(account.securityTag, 'base64url');
  const expected = Buffer.from(accountIntegrityTag(key, account), 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('INVALID_ACCOUNT_INTEGRITY');
}

async function decodeBackup(adminKey: string, contents: string): Promise<{ document: StateDocument; dataKey: Buffer }> {
  try {
    const envelope = JSON.parse(contents) as BackupEnvelope;
    if (envelope.format !== 'team-checkin-backup' || envelope.version !== 1) throw new Error();
    const backupKey = await deriveKey(adminKey, Buffer.from(envelope.salt, 'base64url'), 'backup');
    const document = decryptJson<StateDocument>(backupKey, envelope.sealed, 'team-checkin-backup:v1');
    const admin = document.accounts.find((account) => account.id === document.system.adminAccountId);
    const parts = parseLoginKey(adminKey);
    if (!admin || !parts || parts.publicId !== admin.publicId || !(await verifySecret(admin.secretHash, parts.secret))) throw new Error();
    const wrappingKey = await deriveKey(adminKey, Buffer.from(document.system.wrapSalt, 'base64url'), 'wrap');
    const dataKey = decryptBuffer(wrappingKey, document.system.wrappedDataKey, 'system:dek:v1');
    return { document, dataKey };
  } catch {
    throw new Error('INVALID_BACKUP');
  }
}
