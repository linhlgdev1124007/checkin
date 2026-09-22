import { beforeEach, describe, expect, it } from 'vitest';
import { CheckinService } from '../../src/server/application/checkin-service.js';
import { MemoryStateRepository, type StateRepository } from '../../src/server/data/state-repository.js';
import type { StateDocument } from '../../src/server/data/state-types.js';
import { Vault } from '../../src/server/security/vault.js';

describe('CheckinService', () => {
  let repository: MemoryStateRepository;
  let service: CheckinService;

  beforeEach(() => {
    repository = new MemoryStateRepository();
    service = new CheckinService(repository, new Vault('boot-a'));
  });

  it('allows exactly one initial administrator and only returns the key at setup', async () => {
    const first = await service.setup('Quản trị viên');
    expect(first.key).toMatch(/^ck_/);
    expect((await service.status()).state).toBe('unlocked');
    await expect(service.setup('Kẻ đến sau')).rejects.toThrow('ALREADY_INITIALIZED');
    expect(JSON.stringify(await repository.read())).not.toContain(first.key);
  });

  it('allows only one winner when initial setup requests race', async () => {
    const other = new CheckinService(repository, new Vault('boot-race'));
    const results = await Promise.allSettled([service.setup('Admin A'), other.setup('Admin B')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await repository.read())?.accounts.filter((account) => account.role === 'admin')).toHaveLength(1);
  });

  it('requires the administrator key after a restart', async () => {
    const setup = await service.setup('Admin');
    const restarted = new CheckinService(repository, new Vault('boot-b'));
    expect((await restarted.status()).state).toBe('locked');
    await expect(restarted.unlock('ck_aaaaaaaaaa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toThrow('INVALID_KEY');
    const session = await restarted.unlock(`  ${setup.key}\r\n`);
    expect(session.token).toHaveLength(43);
    expect((await restarted.status()).state).toBe('unlocked');
  });

  it('creates a member whose key is immediately revocable', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    expect((await service.login(member.key)).account.name).toBe('Nguyễn An');

    const rotated = await service.rotateMemberKey(actor, member.account.id);
    await expect(service.login(member.key)).rejects.toThrow('INVALID_KEY');
    expect((await service.login(rotated.key)).account.id).toBe(member.account.id);
  });

  it('requires unique normalized account names', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn   An');
    await expect(service.createAccount(actor, '  nguyễn an  ')).rejects.toThrow('ACCOUNT_NAME_EXISTS');
    const other = await service.createAccount(actor, 'Trần Bình');
    await expect(service.updateAccount(actor, other.account.id, { name: 'NGUYỄN AN' })).rejects.toThrow('ACCOUNT_NAME_EXISTS');
    expect((await service.listAccounts(actor)).find((account) => account.id === member.account.id)?.name).toBe('Nguyễn An');
  });

  it('invalidates a member session immediately when the account is disabled', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    const login = await service.login(member.key);
    await service.updateAccount(actor, member.account.id, { active: false });
    await expect(service.authenticate(login.token)).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects a login that races with credential rotation', async () => {
    const inner = new MemoryStateRepository();
    const pausing = new PausingRepository(inner);
    const raceService = new CheckinService(pausing, new Vault('race-boot'));
    const admin = await raceService.setup('Admin');
    const actor = await raceService.authenticate(admin.token);
    const member = await raceService.createAccount(actor, 'Nguyễn An');
    const gate = pausing.pauseNextMutation();

    const staleLogin = raceService.login(member.key);
    await gate.reached;
    await raceService.rotateMemberKey(actor, member.account.id);
    gate.release();

    await expect(staleLogin).rejects.toThrow('INVALID_KEY');
  });

  it('rejects account authorization metadata modified outside the encrypted workflow', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    const login = await service.login(member.key);
    await repository.mutate((state) => {
      const account = state.accounts.find((candidate) => candidate.id === member.account.id)!;
      account.role = 'admin';
    });
    await expect(service.authenticate(login.token)).rejects.toThrow('INVALID_ACCOUNT_INTEGRITY');
  });

  it('records one open session and atomically queues Telegram messages', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    const login = await service.login(member.key);
    const memberActor = await service.authenticate(login.token);

    await service.checkIn(memberActor, new Date('2026-09-20T00:00:00.000Z'));
    await expect(service.checkIn(memberActor, new Date('2026-09-20T00:01:00.000Z'))).rejects.toThrow('ALREADY_CHECKED_IN');
    await service.checkOut(memberActor, new Date('2026-09-20T02:30:00.000Z'));

    const dashboard = await service.dashboard(memberActor, new Date('2026-09-20T03:00:00.000Z'));
    const row = dashboard.members.find((item) => item.id === member.account.id);
    expect(row).toMatchObject({ completedMilliseconds: 9_000_000, isOnline: false });
    expect((await repository.read())?.outbox).toHaveLength(2);
  });

  it('keeps the original attendance events when an admin corrects a session', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    const memberActor = await service.authenticate((await service.login(member.key)).token);
    const started = await service.checkIn(memberActor, new Date('2026-09-20T00:00:00.000Z'));
    await service.checkOut(memberActor, new Date('2026-09-20T01:00:00.000Z'));

    await service.correctAttendance(actor, member.account.id, started.sessionId, {
      startAt: '2026-09-20T00:15:00.000Z',
      endAt: '2026-09-20T01:45:00.000Z',
      reason: 'Đối chiếu camera',
    }, new Date('2026-09-21T00:00:00.000Z'));

    const dashboard = await service.dashboard(actor, new Date('2026-09-21T00:00:00.000Z'));
    expect(dashboard.members.find((item) => item.id === member.account.id)?.completedMilliseconds).toBe(5_400_000);
    expect((await service.audit(actor)).filter((event) => event.type.startsWith('ATTENDANCE'))).toHaveLength(1);
    expect((await repository.read())?.events.filter((event) =>
      event.accountId === member.account.id && ['CHECKED_IN', 'CHECKED_OUT', 'ATTENDANCE_CORRECTED'].includes(event.type),
    )).toHaveLength(3);
  });

  it('adds and subtracts audited time and queues the configured announcement', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    const memberActor = await service.authenticate((await service.login(member.key)).token);
    await service.checkIn(memberActor, new Date('2026-09-20T00:00:00.000Z'));
    await service.checkOut(memberActor, new Date('2026-09-20T01:00:00.000Z'));
    await repository.mutate((state) => { state.outbox = []; });

    const templates = await service.getTelegramTemplates(actor);
    await service.updateTelegramTemplates(actor, {
      ...templates,
      adjustment: '{name}: {operation} {adjustment}; {reason}; tổng {duration}',
    });
    await service.adjustAttendance(actor, member.account.id, 1_800_000, 'Bổ sung họp', new Date('2026-09-21T00:00:00.000Z'));

    expect((await service.dashboard(actor)).members.find((row) => row.id === member.account.id)?.completedMilliseconds).toBe(5_400_000);
    expect((await service.audit(actor)).find((event) => event.type === 'ATTENDANCE_ADJUSTED')?.payload).toMatchObject({
      adjustmentMilliseconds: 1_800_000,
      reason: 'Bổ sung họp',
    });
    expect((await service.takeDueOutbox(new Date('2026-09-21T00:00:01.000Z')))?.text).toBe('Nguyễn An: Cộng 0 giờ 30 phút; Bổ sung họp; tổng 1 giờ 30 phút');

    await expect(service.adjustAttendance(actor, member.account.id, -7_200_000, 'Trừ quá mức')).rejects.toThrow('NEGATIVE_ATTENDANCE_TOTAL');
    expect((await service.audit(actor)).filter((event) => event.type === 'ATTENDANCE_ADJUSTED')).toHaveLength(1);
  });

  it('validates Telegram template placeholders', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const templates = await service.getTelegramTemplates(actor);
    await expect(service.updateTelegramTemplates(actor, { ...templates, checkIn: '{name} {unknown}' })).rejects.toThrow('INVALID_TEMPLATE');
    await expect(service.updateTelegramTemplates(actor, { ...templates, adjustment: '{reason}'.repeat(10) })).rejects.toThrow('INVALID_TEMPLATE');
    expect(await service.getTelegramTemplates(actor)).toEqual(templates);
  });

  it('connects Telegram once and processes each command update at most once', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');

    expect(await service.handleTelegramUpdate({ updateId: 10, userId: '123456', username: 'nguyenan', text: '/connect   nguyễn an' })).toMatchObject({ processed: true });
    expect((await service.listAccounts(actor)).find((account) => account.id === member.account.id)).toMatchObject({ telegramLinked: true, telegramUsername: 'nguyenan' });
    expect(JSON.stringify(await repository.read())).not.toContain('123456');
    await service.updateAccount(actor, member.account.id, { name: 'Nguyễn An Mới' });
    expect((await service.listAccounts(actor)).find((account) => account.id === member.account.id)).toMatchObject({ telegramLinked: true, telegramUsername: 'nguyenan' });

    expect(await service.handleTelegramUpdate({ updateId: 11, userId: '123456', username: 'nguyenan', text: '/in' })).toMatchObject({ processed: true });
    expect((await service.dashboard(actor)).members.find((row) => row.id === member.account.id)?.isOnline).toBe(true);
    expect(await service.handleTelegramUpdate({ updateId: 11, userId: '123456', username: 'nguyenan', text: '/in' })).toEqual({ processed: false, reply: null });

    await service.disconnectTelegram(actor, member.account.id);
    expect((await service.listAccounts(actor)).find((account) => account.id === member.account.id)?.telegramLinked).toBe(false);
    expect((await service.handleTelegramUpdate({ updateId: 12, userId: '123456', username: 'nguyenan', text: '/status' })).reply).toContain('/connect');
  });

  it('rolls back a failed Telegram command while remembering the update', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    await service.handleTelegramUpdate({ updateId: 20, userId: '42', username: null, text: '/connect Nguyễn An', now: new Date('2026-09-20T00:00:00.000Z') });
    await service.handleTelegramUpdate({ updateId: 21, userId: '42', username: null, text: '/in', now: new Date('2026-09-20T01:00:00.000Z') });

    const failed = await service.handleTelegramUpdate({ updateId: 22, userId: '42', username: null, text: '/out', now: new Date('2026-09-20T01:00:00.000Z') });
    expect(failed.reply).toBe('Không thể xử lý lệnh lúc này.');
    expect((await service.dashboard(actor)).members.find((row) => row.id === member.account.id)?.isOnline).toBe(true);
    expect((await service.audit(actor)).filter((event) => event.type === 'CHECKED_OUT')).toHaveLength(0);
    expect(await service.handleTelegramUpdate({ updateId: 22, userId: '42', username: null, text: '/out' })).toEqual({ processed: false, reply: null });
  });

  it('accepts a lower Telegram update ID after a week of inactivity', async () => {
    await service.setup('Admin');
    const first = await service.handleTelegramUpdate({ updateId: 1_000, userId: '42', username: null, text: '/status', now: new Date('2026-09-01T00:00:00.000Z') });
    const duplicate = await service.handleTelegramUpdate({ updateId: 999, userId: '42', username: null, text: '/status', now: new Date('2026-09-02T00:00:00.000Z') });
    const reset = await service.handleTelegramUpdate({ updateId: 5, userId: '42', username: null, text: '/status', now: new Date('2026-09-09T00:00:01.000Z') });
    expect(first.processed).toBe(true);
    expect(duplicate.processed).toBe(false);
    expect(reset.processed).toBe(true);
  });

  it('durably rejects a Telegram command received while the vault is locked', async () => {
    const admin = await service.setup('Admin');
    const locked = new CheckinService(repository, new Vault('locked-command'));
    await locked.recordRejectedTelegramUpdate(50, new Date('2026-09-20T00:00:00.000Z'));
    await locked.unlock(admin.key);
    expect(await locked.handleTelegramUpdate({ updateId: 50, userId: '42', username: null, text: '/status', now: new Date('2026-09-20T00:00:01.000Z') })).toEqual({ processed: false, reply: null });
  });

  it('allows checkout after an administrator reopens a completed session', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const member = await service.createAccount(actor, 'Nguyễn An');
    const memberActor = await service.authenticate((await service.login(member.key)).token);
    const started = await service.checkIn(memberActor, new Date('2026-09-20T00:00:00.000Z'));
    await service.checkOut(memberActor, new Date('2026-09-20T01:00:00.000Z'));
    await service.correctAttendance(actor, member.account.id, started.sessionId, {
      startAt: '2026-09-20T00:00:00.000Z', endAt: null, reason: 'Checkout nhầm',
    }, new Date('2026-09-20T01:30:00.000Z'));

    await service.checkOut(memberActor, new Date('2026-09-20T02:00:00.000Z'));
    const row = (await service.dashboard(actor)).members.find((item) => item.id === member.account.id);
    expect(row).toMatchObject({ isOnline: false, completedMilliseconds: 7_200_000 });
  });

  it('round-trips a backup and rejects a modified backup without changing state', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    await service.createAccount(actor, 'Nguyễn An');
    const backup = await service.exportBackup(actor, admin.key);

    const parsed = JSON.parse(backup) as { sealed: { ciphertext: string } };
    const ciphertext = Buffer.from(parsed.sealed.ciphertext, 'base64url');
    ciphertext[0] ^= 1;
    parsed.sealed.ciphertext = ciphertext.toString('base64url');
    const before = JSON.stringify(await repository.read());
    await expect(service.importBackup(actor, admin.key, JSON.stringify(parsed))).rejects.toThrow('INVALID_BACKUP');
    expect(JSON.stringify(await repository.read())).toBe(before);

    const cleanRepository = new MemoryStateRepository();
    const restored = new CheckinService(cleanRepository, new Vault('boot-c'));
    await restored.restoreIntoEmpty(admin.key, backup);
    expect((await restored.status()).state).toBe('unlocked');
    expect((await cleanRepository.read())?.accounts).toHaveLength(2);
  });

  it('accepts surrounding whitespace for backup key derivation', async () => {
    const admin = await service.setup('Admin');
    const actor = await service.authenticate(admin.token);
    const backup = await service.exportBackup(actor, `\n${admin.key}  `);
    const cleanRepository = new MemoryStateRepository();
    const restored = new CheckinService(cleanRepository, new Vault('trimmed-backup'));
    await restored.restoreIntoEmpty(`  ${admin.key}\t`, backup);
    expect((await restored.status()).state).toBe('unlocked');
  });
});

class PausingRepository implements StateRepository {
  private gate: { reached: () => void; wait: Promise<void> } | null = null;

  constructor(private readonly inner: StateRepository) {}

  pauseNextMutation(): { reached: Promise<void>; release: () => void } {
    let announce!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { announce = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.gate = { reached: announce, wait };
    return { reached, release };
  }

  read() { return this.inner.read(); }
  initialize(document: StateDocument) { return this.inner.initialize(document); }
  replace(document: StateDocument) { return this.inner.replace(document); }
  async mutate<T>(operation: (draft: StateDocument) => Promise<T> | T): Promise<T> {
    const gate = this.gate;
    if (gate) {
      this.gate = null;
      gate.reached();
      await gate.wait;
    }
    return this.inner.mutate(operation);
  }
}
