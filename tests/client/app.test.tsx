// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App.js';
import type { Api } from '../../src/client/api.js';

describe('App bootstrap', () => {
  it('shows the generated administrator key once after first setup', async () => {
    const api = {
      status: async () => ({ state: 'uninitialized' as const }),
      setup: async () => ({ key: 'ck_0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789', account: { id: 'admin', name: 'Admin', role: 'admin' as const } }),
    } as unknown as Api;
    render(<App api={api} />);

    expect(await screen.findByText('Khởi tạo hệ thống')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tên quản trị viên'), { target: { value: 'Admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo admin key' }));

    expect(await screen.findByText('Lưu key này ngay')).toBeInTheDocument();
    expect(screen.getByText(/^ck_0123456789_/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vào hệ thống' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Tôi đã lưu key ở nơi an toàn'));
    expect(screen.getByRole('button', { name: 'Vào hệ thống' })).toBeEnabled();
  });

  it('shows unlock instead of member login while a restarted system is locked', async () => {
    const api = { status: async () => ({ state: 'locked' as const }) } as unknown as Api;
    render(<App api={api} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mở khóa hệ thống' })).toBeInTheDocument());
    expect(screen.getByLabelText('Admin key')).toHaveAttribute('type', 'password');
  });

  it('restores an encrypted backup before creating a new administrator', async () => {
    const restored: Array<[string, string]> = [];
    const api = {
      status: async () => ({ state: 'uninitialized' as const }),
      restore: async (key: string, backup: string) => { restored.push([key, backup]); },
    } as unknown as Api;
    render(<App api={api} />);
    await screen.findByText('Khởi tạo hệ thống');
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục từ backup' }));
    fireEvent.change(screen.getByLabelText('Admin key của backup'), { target: { value: 'old-admin-key' } });
    const file = { name: 'backup.json', text: async () => '{"encrypted":true}' };
    fireEvent.change(screen.getByLabelText('File backup'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục dữ liệu' }));
    await waitFor(() => expect(restored).toEqual([['old-admin-key', '{"encrypted":true}']]));
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
  });
});
