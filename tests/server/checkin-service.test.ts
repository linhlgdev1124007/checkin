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
