import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Clipboard, KeyRound, Plus, RefreshCw, Save, ShieldAlert, UserRoundCheck, UserRoundX } from 'lucide-react';
import type { Account, Api, AuditEntry, OutboxItem } from '../api.js';
import { ErrorText } from './AuthScreens.js';

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function MembersPanel({ api }: { api: Api }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>('load');

  const load = async () => setAccounts((await api.accounts()).accounts);
  useEffect(() => {
    void load().catch((cause) => setError(errorMessage(cause, 'Không tải được tài khoản.'))).finally(() => setBusy(null));
  }, []);

  const run = async (action: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể thực hiện thao tác.'));
    } finally {
      setBusy(null);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run('create', async () => {
      const result = await api.createAccount(name);
      setKey(result.key);
      setName('');
      await load();
    });
  };

  return <div className="space-y-6"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">Tài khoản</p><h3>Quản lý thành viên</h3></div></div>
    <form className="flex flex-col sm:flex-row gap-3 px-5 pb-5" onSubmit={create}>
      <input className="field-input flex-1" placeholder="Tên thành viên mới" value={name} disabled={busy !== null} onChange={(event) => setName(event.target.value)}/>
      <button className="secondary-button" disabled={busy !== null || name.trim().length < 2}><Plus size={18}/> {busy === 'create' ? 'Đang tạo…' : 'Tạo thành viên'}</button>
    </form>
    {error && <div className="px-5 pb-5"><ErrorText text={error}/></div>}
    {key && <KeyReveal value={key} onClose={() => setKey('')} onError={setError}/>}
    <div className="divide-y divide-slate-800">{accounts.map((item) => <AccountRow key={item.id} item={item} api={api} busy={busy} run={run} reload={load} reveal={setKey}/>)}</div>
  </section></div>;
}

function AccountRow({ item, api, busy, run, reload, reveal }: {
  item: Account;
  api: Api;
  busy: string | null;
  run: (action: string, operation: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
  reveal: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const action = (kind: string) => `${kind}:${item.id}`;

  const save = () => void run(action('save'), async () => {
    await api.updateAccount(item.id, { name });
    setEditing(false);
    await reload();
  });
  const rotate = () => void run(action('rotate'), async () => reveal((await api.rotateKey(item.id)).key));
  const toggle = () => void run(action('toggle'), async () => {
    await api.updateAccount(item.id, { active: !item.active });
    await reload();
  });

  return <div className="account-row">
    <div className="min-w-0 flex-1">{editing
      ? <input className="field-input" value={name} disabled={busy !== null} onChange={(event) => setName(event.target.value)}/>
      : <><p className="font-medium truncate">{item.name}</p><p className="text-xs text-slate-500 mt-1">{item.role === 'admin' ? 'Quản trị viên' : item.active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</p></>}
    </div>
    {item.role === 'member' && <div className="flex flex-wrap gap-2 justify-end">
      {editing
        ? <button className="icon-button" aria-label="Lưu tên" disabled={busy !== null || name.trim().length < 2} onClick={save}><Save size={17}/></button>
        : <button className="small-button" disabled={busy !== null} onClick={() => setEditing(true)}>Đổi tên</button>}
      <button className="small-button" disabled={busy !== null} onClick={rotate}><KeyRound size={15}/> {busy === action('rotate') ? 'Đang cấp…' : 'Cấp key'}</button>
      <button className="icon-button" aria-label={item.active ? 'Vô hiệu hóa' : 'Kích hoạt'} disabled={busy !== null} onClick={toggle}>{item.active ? <UserRoundX size={17}/> : <UserRoundCheck size={17}/>}</button>
    </div>}
  </div>;
}

function KeyReveal({ value, onClose, onError }: { value: string; onClose: () => void; onError: (message: string) => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (cause) {
      onError(errorMessage(cause, 'Không sao chép được key.'));
    }
  };
  return <div className="mx-5 mb-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 p-4">
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-cyan-300">Key chỉ hiển thị một lần</p><code className="mt-2 block break-all text-xs text-slate-300">{value}</code></div><button className="icon-button" onClick={() => void copy()} aria-label="Sao chép"><Clipboard size={18}/></button></div>
    <button className="small-button mt-4" onClick={onClose}>Tôi đã lưu key</button>
  </div>;
}

export function AuditPanel({ api }: { api: Api }) {
  const [events, setEvents] = useState<AuditEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [form, setForm] = useState({ accountId: '', sessionId: '', startAt: '', endAt: '', reason: '' });
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const [audit, members] = await Promise.all([api.audit(), api.accounts()]);
      setEvents(audit.events);
      setAccounts(members.accounts);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tải được audit log.'));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const correct = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.correct(form.accountId, form.sessionId, {
        startAt: new Date(form.startAt).toISOString(),
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
        reason: form.reason,
      });
      setForm({ accountId: '', sessionId: '', startAt: '', endAt: '', reason: '' });
      const audit = await api.audit();
      setEvents(audit.events);
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể điều chỉnh.'));
    } finally {
      setBusy(false);
    }
  };

  const originalTimes = (event: AuditEntry) => {
    const sessionId = event.payload.sessionId;
    const related = events.filter((candidate) => candidate.payload.sessionId === sessionId);
    return {
      start: related.find((candidate) => candidate.type === 'CHECKED_IN')?.payload.at,
      end: related.find((candidate) => candidate.type === 'CHECKED_OUT')?.payload.at,
    };
  };

  return <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
    <section className="panel p-5"><p className="eyebrow">Có nhật ký</p><h3 className="mt-1">Điều chỉnh phiên</h3>
      <form onSubmit={(event) => void correct(event)} className="mt-5 space-y-3">
        <select className="field-input" value={form.accountId} disabled={busy} onChange={(event) => setForm({ ...form, accountId: event.target.value })}><option value="">Chọn thành viên</option>{accounts.filter((account) => account.role === 'member').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
        <input className="field-input" placeholder="Session ID từ audit" value={form.sessionId} disabled={busy} onChange={(event) => setForm({ ...form, sessionId: event.target.value })}/>
        <label className="field-label">Giờ vào<input className="field-input mt-1" type="datetime-local" value={form.startAt} disabled={busy} onChange={(event) => setForm({ ...form, startAt: event.target.value })}/></label>
        <label className="field-label">Giờ ra (để trống nếu còn mở)<input className="field-input mt-1" type="datetime-local" value={form.endAt} disabled={busy} onChange={(event) => setForm({ ...form, endAt: event.target.value })}/></label>
        <textarea className="field-input" placeholder="Lý do bắt buộc" value={form.reason} disabled={busy} onChange={(event) => setForm({ ...form, reason: event.target.value })}/>
        {error && <ErrorText text={error}/>}<button className="secondary-button w-full" disabled={busy || !form.accountId || !form.sessionId || !form.startAt || !form.reason}><Save size={17}/> {busy ? 'Đang xử lý…' : 'Lưu điều chỉnh'}</button>
      </form>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Chuỗi toàn vẹn</p><h3>Audit log</h3></div><button className="icon-button" aria-label="Làm mới audit log" disabled={busy} onClick={() => void load()}><RefreshCw size={17}/></button></div>
      <div className="max-h-[640px] overflow-auto divide-y divide-slate-800">{events.map((event) => {
        const original = originalTimes(event);
        return <div key={event.id} className="p-4"><div className="flex justify-between gap-4"><span className="event-type">{event.type}</span><time className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString('vi-VN')}</time></div>
          <p className="mt-2 text-xs text-slate-400">Người thực hiện: {accountNames.get(event.actorId) ?? event.actorId}</p>
          <p className="mt-1 text-xs text-slate-400">Thành viên: {accountNames.get(event.accountId) ?? event.accountId}</p>
          {'sessionId' in event.payload && <p className="mt-1 text-xs text-slate-400 break-all">Session: {String(event.payload.sessionId)}</p>}
          {event.type === 'ATTENDANCE_CORRECTED' && <div className="mt-2 space-y-1 text-xs text-slate-300"><p>{String(event.payload.reason ?? '')}</p><p>Giờ gốc: {String(original.start ?? 'Không có')} → {String(original.end ?? 'Đang mở')}</p><p>Giờ hiệu lực: {String(event.payload.startAt ?? '')} → {String(event.payload.endAt ?? 'Đang mở')}</p></div>}
        </div>;
      })}</div>
    </section>
  </div>;
}

export function OperationsPanel({ api, onLocked }: { api: Api; onLocked: () => void }) {
  const [key, setKey] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>('load');

  const load = async () => setOutbox((await api.outbox()).items);
  useEffect(() => {
    void load().catch((cause) => setError(errorMessage(cause, 'Không tải được hàng đợi Telegram.'))).finally(() => setBusy(null));
  }, []);

  const run = async (action: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể thực hiện thao tác.'));
    } finally {
      setBusy(null);
    }
  };

  const exportFile = () => void run('export', async () => {
    const contents = await api.exportBackup(key);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `team-checkin-${new Date().toISOString().slice(0, 10)}.backup.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('Đã tạo file backup mã hóa.');
  });
  const importFile = () => {
    if (!file || !confirm('Khôi phục sẽ ghi đè toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
    void run('import', async () => {
      await api.importBackup(key, await file.text());
      setMessage('Khôi phục thành công. Hãy đăng nhập lại.');
      onLocked();
    });
  };
  const retry = (id: string) => void run(`retry:${id}`, async () => { await api.retryOutbox(id); await load(); });
  const refresh = () => void run('refresh', load);
  const lock = () => {
    if (!confirm('Khóa hệ thống ngay?')) return;
    void run('lock', async () => { await api.lock(); onLocked(); });
  };

  return <div className="grid gap-6 lg:grid-cols-2">
    <section className="panel p-5"><Archive className="text-cyan-300"/><h3 className="mt-4">Backup mã hóa</h3><p className="mt-2 text-sm text-slate-400">Xuất hoặc phục hồi toàn bộ dữ liệu bằng admin key.</p>
      <input className="field-input mt-5" type="password" placeholder="Admin key" value={key} disabled={busy !== null} onChange={(event) => setKey(event.target.value)}/>
      <div className="mt-3 flex flex-wrap gap-2"><button className="secondary-button" disabled={busy !== null || !key} onClick={exportFile}>{busy === 'export' ? 'Đang xuất…' : 'Xuất backup'}</button><label className={`small-button cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>Chọn file<input className="hidden" type="file" accept="application/json" disabled={busy !== null} onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label><button className="small-button" disabled={busy !== null || !key || !file} onClick={importFile}>{busy === 'import' ? 'Đang khôi phục…' : 'Khôi phục'}</button></div>
      {message && <p className="mt-4 text-sm text-emerald-400">{message}</p>}{error && <div className="mt-4"><ErrorText text={error}/></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Telegram</p><h3>Hàng đợi gửi tin</h3></div><button className="icon-button" aria-label="Làm mới hàng đợi" disabled={busy !== null} onClick={refresh}><RefreshCw size={17}/></button></div>
      <div className="divide-y divide-slate-800">{outbox.length === 0 && <p className="p-5 text-sm text-slate-500">Chưa có tin nhắn.</p>}{outbox.map((item) => <div className="p-4 flex justify-between gap-4" key={item.id}><div><p className="text-sm">{item.status === 'sent' ? 'Đã gửi' : item.status === 'sending' ? 'Đang gửi' : 'Đang chờ'} · {item.attempts} lần thử</p>{item.lastError && <p className="mt-1 text-xs text-rose-400">{item.lastError}</p>}</div>{item.status !== 'sent' && <button className="small-button" disabled={busy !== null} onClick={() => retry(item.id)}>{busy === `retry:${item.id}` ? 'Đang thử…' : 'Thử lại'}</button>}</div>)}</div>
    </section>
    <section className="panel p-5 lg:col-span-2 border-rose-500/20"><ShieldAlert className="text-rose-400"/><h3 className="mt-4">Khóa hệ thống</h3><p className="mt-2 text-sm text-slate-400">Xóa khóa giải mã khỏi RAM và đăng xuất toàn bộ phiên hiện tại.</p><button className="danger-button mt-5" disabled={busy !== null} onClick={lock}>{busy === 'lock' ? 'Đang khóa…' : 'Khóa ngay'}</button></section>
  </div>;
}
