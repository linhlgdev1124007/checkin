export type Role = 'admin' | 'member';
export interface Account { id: string; name: string; role: Role; active?: boolean; createdAt?: string; telegramLinked?: boolean; telegramUsername?: string | null }
export interface DashboardMember { id: string; name: string; completedMilliseconds: number; isOnline: boolean; openSince: string | null }
export interface AuditEntry { id: string; type: string; accountId: string; actorId: string; createdAt: string; payload: Record<string, unknown> }
export interface OutboxItem { id: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null }
export interface TelegramTemplates { checkIn: string; checkOut: string; adjustment: string; connected: string }

export interface Api {
  status(): Promise<{ state: 'uninitialized' | 'locked' | 'unlocked' }>;
  setup(name: string): Promise<{ key: string; account: Account }>;
  unlock(key: string): Promise<{ account: Account }>;
  login(key: string): Promise<{ account: Account }>;
  session(): Promise<{ account: Account }>;
  logout(): Promise<void>;
  lock(): Promise<void>;
  dashboard(): Promise<{ now: string; members: DashboardMember[] }>;
  checkIn(): Promise<{ sessionId: string }>;
  checkOut(): Promise<{ sessionId: string }>;
  accounts(): Promise<{ accounts: Account[] }>;
  createAccount(name: string): Promise<{ key: string; account: Account }>;
  updateAccount(id: string, update: { name?: string; active?: boolean }): Promise<void>;
  rotateKey(id: string): Promise<{ key: string }>;
  disconnectTelegram(id: string): Promise<void>;
  audit(): Promise<{ events: AuditEntry[] }>;
  correct(accountId: string, sessionId: string, input: { startAt: string; endAt: string | null; reason: string }): Promise<void>;
  adjustAttendance(accountId: string, input: { adjustmentMilliseconds: number; reason: string }): Promise<void>;
  telegramTemplates(): Promise<{ templates: TelegramTemplates }>;
  updateTelegramTemplates(templates: TelegramTemplates): Promise<void>;
  outbox(): Promise<{ items: OutboxItem[] }>;
  retryOutbox(id: string): Promise<void>;
  exportBackup(key: string): Promise<string>;
  importBackup(key: string, backup: string): Promise<void>;
  restore(key: string, backup: string): Promise<void>;
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { code: 'NETWORK_ERROR', message: 'Không thể kết nối máy chủ.' } })) as { error: { code: string; message: string } };
    throw new ApiError(body.error.code, body.error.message);
  }
  if (response.status === 204) return undefined as T;
  return response.text().then((text) => text ? JSON.parse(text) as T : undefined as T);
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api: Api = {
  status: () => request('/api/system/status'),
  setup: (name) => request('/api/setup', json('POST', { name })),
  unlock: (key) => request('/api/system/unlock', json('POST', { key })),
  login: (key) => request('/api/auth/login', json('POST', { key })),
  session: () => request('/api/auth/session'),
  logout: () => request('/api/auth/logout', json('POST')),
  lock: () => request('/api/system/lock', json('POST')),
  dashboard: () => request('/api/dashboard'),
  checkIn: () => request('/api/attendance/check-in', json('POST')),
  checkOut: () => request('/api/attendance/check-out', json('POST')),
  accounts: () => request('/api/accounts'),
  createAccount: (name) => request('/api/accounts', json('POST', { name })),
  updateAccount: (id, update) => request(`/api/accounts/${id}`, json('PATCH', update)),
  rotateKey: (id) => request(`/api/accounts/${id}/rotate-key`, json('POST')),
  disconnectTelegram: (id) => request(`/api/accounts/${id}/telegram`, json('DELETE')),
  audit: () => request('/api/admin/audit'),
  correct: (accountId, sessionId, input) => request(`/api/admin/attendance/${accountId}/${sessionId}/corrections`, json('POST', input)),
  adjustAttendance: (accountId, input) => request(`/api/admin/attendance/${accountId}/adjustments`, json('POST', input)),
  telegramTemplates: () => request('/api/admin/telegram/templates'),
  updateTelegramTemplates: (templates) => request('/api/admin/telegram/templates', json('PUT', templates)),
  outbox: () => request('/api/admin/telegram-outbox'),
  retryOutbox: (id) => request(`/api/admin/telegram-outbox/${id}/retry`, json('POST')),
  exportBackup: async (key) => {
    const response = await fetch('/api/admin/backups/export', { ...json('POST', { key }), credentials: 'same-origin', headers: { 'content-type': 'application/json' } });
    if (!response.ok) {
      const body = await response.json() as { error: { code: string; message: string } };
      throw new ApiError(body.error.code, body.error.message);
    }
    return response.text();
  },
  importBackup: (key, backup) => request('/api/admin/backups/import', json('POST', { key, backup })),
  restore: (key, backup) => request('/api/restore', json('POST', { key, backup })),
};
