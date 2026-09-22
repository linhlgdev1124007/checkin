// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditPanel, MembersPanel, OperationsPanel } from '../../src/client/components/Admin.js';
import type { Api } from '../../src/client/api.js';

describe('admin actions', () => {
  it('shows account action errors instead of leaving an unhandled rejection', async () => {
    const api = {
      accounts: async () => ({ accounts: [{ id: 'member', name: 'Nguyễn An', role: 'member' as const, active: true }] }),
      rotateKey: async () => { throw new Error('Không cấp lại được key.'); },
    } as unknown as Api;
    render(<MembersPanel api={api}/>);
    fireEvent.click(await screen.findByRole('button', { name: /Cấp key/ }));
    expect(await screen.findByText('Không cấp lại được key.')).toBeInTheDocument();
  });

  it('disables an account action while its request is in flight', async () => {
    let finish!: (value: { key: string }) => void;
    const api = {
      accounts: async () => ({ accounts: [{ id: 'member', name: 'Nguyễn An', role: 'member' as const, active: true }] }),
      rotateKey: () => new Promise<{ key: string }>((resolve) => { finish = resolve; }),
    } as unknown as Api;
    render(<MembersPanel api={api}/>);
    const button = await screen.findByRole('button', { name: /Cấp key/ });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    finish({ key: 'ck_new' });
    expect(await screen.findByText('ck_new')).toBeInTheDocument();
  });

  it('shows and disconnects a linked Telegram account', async () => {
    let disconnected = '';
    const api = {
      accounts: async () => ({ accounts: [{ id: 'member', name: 'Nguyễn An', role: 'member' as const, active: true, telegramLinked: true, telegramUsername: 'nguyenan' }] }),
      disconnectTelegram: async (id: string) => { disconnected = id; },
    } as unknown as Api;
    render(<MembersPanel api={api}/>);
    expect(await screen.findByText('@nguyenan')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ngắt liên kết Telegram' }));
    await waitFor(() => expect(disconnected).toBe('member'));
  });

  it('shows backup errors and restores the button after failure', async () => {
    const api = {
      outbox: async () => ({ items: [] }),
      exportBackup: async () => { throw new Error('Admin key không hợp lệ.'); },
    } as unknown as Api;
    render(<OperationsPanel api={api} onLocked={() => undefined}/>);
    fireEvent.change(screen.getByPlaceholderText('Admin key'), { target: { value: 'wrong-key' } });
    const button = screen.getByRole('button', { name: 'Xuất backup' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(await screen.findByText('Admin key không hợp lệ.')).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('edits Telegram message templates', async () => {
    let saved = '';
    const api = {
      outbox: async () => ({ items: [] }),
      telegramTemplates: async () => ({ templates: { checkIn: '{name} IN {duration}', checkOut: '{name} OUT {duration}', adjustment: '{name} {operation} {adjustment} {reason} {duration}', connected: '{name} connected' } }),
      updateTelegramTemplates: async (templates: { checkIn: string }) => { saved = templates.checkIn; },
    } as unknown as Api;
    render(<OperationsPanel api={api} onLocked={() => undefined}/>);
    const input = await screen.findByLabelText('Mẫu check-in');
    fireEvent.change(input, { target: { value: '[{name}] {action}: {duration}' } });
    expect(screen.getByText('Xem trước: [Nguyễn An] IN: 2 giờ 30 phút')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới hàng đợi' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Làm mới hàng đợi' })).toBeEnabled());
    expect(input).toHaveValue('[{name}] {action}: {duration}');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu tin' }));
    await waitFor(() => expect(saved).toBe('[{name}] {action}: {duration}'));
  });
});

describe('audit details', () => {
  it('shows readable actors, members, correction reason, and corrected times', async () => {
    const api = {
      accounts: async () => ({ accounts: [
        { id: 'admin', name: 'Minh Admin', role: 'admin' as const, active: true },
        { id: 'member', name: 'Nguyễn An', role: 'member' as const, active: true },
      ] }),
      audit: async () => ({ events: [
        {
          id: 'event', type: 'ATTENDANCE_CORRECTED', accountId: 'member', actorId: 'admin', createdAt: '2026-09-21T00:00:00.000Z',
          payload: { sessionId: 'session-1', startAt: '2026-09-20T00:15:00.000Z', endAt: '2026-09-20T01:45:00.000Z', reason: 'Đối chiếu camera' },
        },
        {
          id: 'checkout', type: 'CHECKED_OUT', accountId: 'member', actorId: 'member', createdAt: '2026-09-20T02:00:00.000Z',
          payload: { sessionId: 'session-1', at: '2026-09-20T02:00:00.000Z' },
        },
        {
          id: 'checkin', type: 'CHECKED_IN', accountId: 'member', actorId: 'member', createdAt: '2026-09-20T00:00:00.000Z',
          payload: { sessionId: 'session-1', at: '2026-09-20T00:00:00.000Z' },
        },
      ] }),
    } as unknown as Api;
    render(<AuditPanel api={api}/>);
    expect(await screen.findByText('Đối chiếu camera')).toBeInTheDocument();
    expect(screen.getByText(/Người thực hiện: Minh Admin/)).toBeInTheDocument();
    expect(screen.getAllByText(/Thành viên: Nguyễn An/)).not.toHaveLength(0);
    expect(screen.getByText(/Giờ gốc: 2026-09-20T00:00:00.000Z → 2026-09-20T02:00:00.000Z/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-20T00:15:00.000Z/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-20T01:45:00.000Z/)).toBeInTheDocument();
  });

  it('submits a signed time adjustment with a reason', async () => {
    let submitted: unknown;
    const api = {
      accounts: async () => ({ accounts: [{ id: 'member', name: 'Nguyễn An', role: 'member' as const, active: true }] }),
      audit: async () => ({ events: [] }),
      adjustAttendance: async (accountId: string, input: unknown) => { submitted = { accountId, input }; },
    } as unknown as Api;
    render(<AuditPanel api={api}/>);
    await screen.findByText('Cộng / trừ thời gian');
    fireEvent.change(screen.getByLabelText('Thành viên điều chỉnh'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('Giờ điều chỉnh'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Lý do điều chỉnh'), { target: { value: 'Bổ sung họp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng điều chỉnh' }));
    await waitFor(() => expect(submitted).toEqual({ accountId: 'member', input: { adjustmentMilliseconds: 3_600_000, reason: 'Bổ sung họp' } }));
  });
});
