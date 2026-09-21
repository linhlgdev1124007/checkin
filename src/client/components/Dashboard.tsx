import { useEffect, useMemo, useState } from 'react';
import { Clock3, LogIn, LogOut, RefreshCw, Users } from 'lucide-react';
import type { Account, Api, DashboardMember } from '../api.js';
import { ErrorText } from './AuthScreens.js';

export function Dashboard({ api, account }: { api: Api; account: Account }) {
  const [members, setMembers] = useState<DashboardMember[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [tick, setTick] = useState(Date.now());
  const load = async () => { try { setMembers((await api.dashboard()).members); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được dashboard.'); } };
  useEffect(() => { void load(); const refresh = setInterval(() => void load(), 30_000); const timer = setInterval(() => setTick(Date.now()), 1_000); return () => { clearInterval(refresh); clearInterval(timer); }; }, []);
  const me = members.find((member) => member.id === account.id);
  const live = useMemo(() => me?.openSince ? Math.max(0, tick - Date.parse(me.openSince)) : 0, [me?.openSince, tick]);
  const toggle = async () => { setBusy(true); try { if (me?.isOnline) await api.checkOut(); else await api.checkIn(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể chấm công.'); } finally { setBusy(false); } };
  return <div className="space-y-7">
    <section className="hero-card"><div><p className="eyebrow">Hôm nay bạn thế nào?</p><h2 className="mt-2 text-3xl font-semibold">Xin chào, {account.name}</h2><p className="mt-2 text-slate-400">{me?.isOnline ? 'Bạn đang trong một phiên làm việc.' : 'Sẵn sàng bắt đầu phiên làm việc mới.'}</p></div><button className={`check-button ${me?.isOnline ? 'check-out' : 'check-in'}`} onClick={toggle} disabled={busy}>{me?.isOnline ? <LogOut/> : <LogIn/>}<span>{busy ? 'Đang xử lý…' : me?.isOnline ? 'Check out' : 'Check in'}</span></button></section>
    {error && <ErrorText text={error}/>}<div className="grid gap-4 md:grid-cols-3"><Metric icon={<Clock3/>} label="Tổng đã hoàn tất" value={formatDuration(me?.completedMilliseconds ?? 0)}/><Metric icon={<RefreshCw/>} label="Phiên hiện tại" value={me?.isOnline ? formatDuration(live) : 'Chưa online'}/><Metric icon={<Users/>} label="Thành viên hoạt động" value={`${members.length} người`}/></div>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Toàn đội</p><h3>Bảng đối chiếu tích lũy</h3></div><button className="icon-button" onClick={() => void load()} aria-label="Làm mới"><RefreshCw size={18}/></button></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Thành viên</th><th>Trạng thái</th><th className="text-right">Tổng thời gian</th></tr></thead><tbody>{members.map((member, index) => <tr key={member.id}><td className="rank">{String(index + 1).padStart(2, '0')}</td><td><div className="member-cell"><span className="avatar">{initials(member.name)}</span><span>{member.name}{member.id === account.id && <small>Bạn</small>}</span></div></td><td><span className={`status ${member.isOnline ? 'online' : ''}`}><i/>{member.isOnline ? 'Online' : 'Offline'}</span></td><td className="text-right tabular-nums font-medium">{formatDuration(member.completedMilliseconds)}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="metric"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></div>; }
export function formatDuration(ms: number) { const minutes = Math.max(0, Math.floor(ms / 60_000)); const days = Math.floor(minutes / 1_440); const hours = Math.floor((minutes % 1_440) / 60); const rest = minutes % 60; return days ? `${days} ngày ${hours} giờ ${rest} phút` : `${hours} giờ ${rest} phút`; }
function initials(name: string) { return name.split(' ').slice(-2).map((part) => part[0]).join('').toUpperCase(); }

