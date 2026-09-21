import { useState, type FormEvent } from 'react';
import { Check, Clipboard, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Account, Api } from '../api.js';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen grid lg:grid-cols-[1.15fr_.85fr] bg-ink text-white">
    <section className="hidden lg:flex flex-col justify-between p-14 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-25" />
      <div className="orb orb-one" /><div className="orb orb-two" />
      <div className="relative flex items-center gap-3 text-sm font-semibold tracking-[.2em] uppercase text-cyan-300"><ShieldCheck size={22} /> Team Check-in</div>
      <div className="relative max-w-xl"><p className="eyebrow">Không chỉ là một nút bấm</p><h1 className="text-6xl font-semibold leading-[1.05] tracking-tight">Thời gian rõ ràng.<br/><span className="text-gradient">Đội ngũ đồng bộ.</span></h1><p className="mt-7 text-lg text-slate-300 leading-relaxed">Check in nhanh, đối chiếu minh bạch và bảo vệ dữ liệu bằng khóa do chính bạn kiểm soát.</p></div>
      <p className="relative text-sm text-slate-500">Dữ liệu chỉ được mở sau khi admin xác thực.</p>
    </section>
    <section className="flex min-h-screen items-center justify-center px-5 py-10 bg-[#0b1524] lg:bg-white lg:text-slate-950">
      <div className="w-full max-w-md">{children}</div>
    </section>
  </main>;
}

export function SetupScreen({ api, onReady, onRestored }: { api: Api; onReady: (account: Account) => void; onRestored: () => void }) {
  const [name, setName] = useState('');
  const [result, setResult] = useState<{ key: string; account: Account } | null>(null);
  const [restoreMode, setRestoreMode] = useState(false);
  const [restoreKey, setRestoreKey] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try { setResult(await api.setup(name)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể khởi tạo.'); }
  };
  const restore = async (event: FormEvent) => {
    event.preventDefault();
    if (!backupFile) return;
    setError('');
    try {
      await api.restore(restoreKey, await backupFile.text());
      onRestored();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể khôi phục backup.');
    }
  };
  if (result) return <AuthCard icon={<KeyRound />} title="Lưu key này ngay" subtitle="Key sẽ không xuất hiện lại. Nếu mất key, dữ liệu không thể phục hồi.">
    <div className="key-box"><code>{result.key}</code><button aria-label="Sao chép key" onClick={() => void navigator.clipboard?.writeText(result.key)}><Clipboard size={18}/></button></div>
    <label className="check-row"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /><span>Tôi đã lưu key ở nơi an toàn</span></label>
    <button className="primary-button" disabled={!saved} onClick={() => onReady(result.account)}>Vào hệ thống <Check size={18}/></button>
  </AuthCard>;
  return <AuthCard icon={<ShieldCheck />} title={restoreMode ? 'Khôi phục hệ thống' : 'Khởi tạo hệ thống'} subtitle={restoreMode ? 'Dùng file backup mã hóa và admin key đã tạo file đó.' : 'Bạn là người đầu tiên. Hệ thống sẽ tạo admin key duy nhất cho bạn.'}>
    {restoreMode ? <form onSubmit={restore} className="space-y-5"><Field label="Admin key của backup" value={restoreKey} onChange={setRestoreKey} placeholder="ck_..." secret autoFocus/><label className="block"><span className="field-label">File backup</span><input className="field-input" type="file" accept="application/json" onChange={(event) => setBackupFile(event.target.files?.[0] ?? null)}/></label>{error && <ErrorText text={error}/>}<button className="primary-button" disabled={!restoreKey || !backupFile}>Khôi phục dữ liệu <ShieldCheck size={18}/></button><button type="button" className="small-button w-full" onClick={() => setRestoreMode(false)}>Quay lại tạo admin</button></form> : <><form onSubmit={submit} className="space-y-5"><Field label="Tên quản trị viên" value={name} onChange={setName} placeholder="Ví dụ: Minh Anh" autoFocus />{error && <ErrorText text={error}/>}<button className="primary-button" disabled={name.trim().length < 2}>Tạo admin key <KeyRound size={18}/></button></form><button type="button" className="small-button w-full mt-3" onClick={() => setRestoreMode(true)}>Khôi phục từ backup</button></>}
  </AuthCard>;
}

export function KeyScreen({ mode, api, onReady }: { mode: 'unlock' | 'login'; api: Api; onReady: (account: Account) => void }) {
  const [key, setKey] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const result = mode === 'unlock' ? await api.unlock(key) : await api.login(key); onReady(result.account); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.'); } finally { setBusy(false); } };
  return <AuthCard icon={mode === 'unlock' ? <LockKeyhole/> : <KeyRound/>} title={mode === 'unlock' ? 'Mở khóa hệ thống' : 'Đăng nhập'} subtitle={mode === 'unlock' ? 'Sau khi máy chủ khởi động lại, admin key cần thiết để giải mã dữ liệu.' : 'Nhập key cá nhân đã được admin cấp.'}>
    <form onSubmit={submit} className="space-y-5"><Field label={mode === 'unlock' ? 'Admin key' : 'Key đăng nhập'} value={key} onChange={setKey} placeholder="ck_..." secret autoFocus />{error && <ErrorText text={error}/>}<button className="primary-button" disabled={!key || busy}>{busy ? 'Đang xác thực…' : mode === 'unlock' ? 'Mở khóa' : 'Đăng nhập'} <KeyRound size={18}/></button></form>
  </AuthCard>;
}

function AuthCard({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="auth-card"><div className="brand-mobile"><ShieldCheck size={20}/> TEAM CHECK-IN</div><div className="icon-box">{icon}</div><h2 className="text-3xl font-semibold tracking-tight">{title}</h2><p className="mt-3 mb-8 text-sm leading-6 text-slate-400 lg:text-slate-500">{subtitle}</p>{children}</div>;
}

function Field({ label, value, onChange, placeholder, secret, autoFocus }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; secret?: boolean; autoFocus?: boolean }) {
  return <label className="block"><span className="field-label">{label}</span><input className="field-input" type={secret ? 'password' : 'text'} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function ErrorText({ text }: { text: string }) { return <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{text}</p>; }
