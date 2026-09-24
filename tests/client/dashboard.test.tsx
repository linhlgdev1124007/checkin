// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/client/components/Dashboard.js';
import type { Api } from '../../src/client/api.js';

describe('Dashboard attendance charts', () => {
  afterEach(() => vi.useRealTimers());

  it('shows bar and line charts for the selected member and date range', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T03:00:00.000Z'));
    const historyCalls: string[][] = [];
    const api = {
      dashboard: async () => ({
        now: '2026-09-24T03:00:00.000Z',
        members: [
          { id: 'me', name: 'Nguyễn An', completedMilliseconds: 10_800_000, isOnline: false, openSince: null },
          { id: 'other', name: 'Trần Bình', completedMilliseconds: 7_200_000, isOnline: false, openSince: null },
        ],
      }),
      attendanceHistory: async (from: string, to: string) => {
        historyCalls.push([from, to]);
        return {
          from,
          to,
          members: [
            { id: 'me', name: 'Nguyễn An', days: [
              { date: '2026-09-22', durationMilliseconds: 3_600_000, sessionCount: 1, adjustmentMilliseconds: 0 },
              { date: '2026-09-23', durationMilliseconds: 7_200_000, sessionCount: 2, adjustmentMilliseconds: 1_800_000 },
              { date: '2026-09-24', durationMilliseconds: 0, sessionCount: 0, adjustmentMilliseconds: 0 },
            ] },
            { id: 'other', name: 'Trần Bình', days: [] },
          ],
        };
      },
    } as unknown as Api;

    render(<Dashboard api={api} account={{ id: 'me', name: 'Nguyễn An', role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: 'Thời gian online theo ngày' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Xu hướng online' })).toBeInTheDocument();
    expect(historyCalls[0]).toEqual(['2026-09-22', '2026-09-24']);

    fireEvent.mouseEnter(screen.getAllByLabelText('23/09/2026: 2 giờ 0 phút')[0]);
    expect(screen.getByText('2 phiên làm việc')).toBeInTheDocument();
    expect(screen.getByText('Điều chỉnh: +0 giờ 30 phút')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '7 ngày' }));
    await waitFor(() => expect(historyCalls).toContainEqual(['2026-09-18', '2026-09-24']));
  });
});
