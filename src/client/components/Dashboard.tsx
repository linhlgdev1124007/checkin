import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, LogIn, LogOut, RefreshCw, Users } from 'lucide-react';
import type { Account, Api, AttendanceHistoryDay, AttendanceHistoryMember, DashboardMember } from '../api.js';
import { ErrorText } from './AuthScreens.js';

export function Dashboard({ api, account }: { api: Api; account: Account }) {
  const today = useMemo(() => vietnamDate(new Date()), []);
  const [members, setMembers] = useState<DashboardMember[]>([]);
  const [history, setHistory] = useState<AttendanceHistoryMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState(account.id);
  const [from, setFrom] = useState(() => vietnamDate(addDays(new Date(), -2)));
  const [to, setTo] = useState(today);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const historyRequestId = useRef(0);
  const rangeRef = useRef({ from, to });
  rangeRef.current = { from, to };

  const loadDashboard = async () => {
    try { setMembers((await api.dashboard()).members); setError(''); }
    catch (cause) { setError(errorMessage(cause, 'Không tải được dashboard.')); }
  };
  const loadHistory = async (range = rangeRef.current) => {
    const requestId = ++historyRequestId.current;
    try {
      const result = await api.attendanceHistory(range.from, range.to);
      const currentRange = rangeRef.current;
      if (requestId === historyRequestId.current && result.from === currentRange.from && result.to === currentRange.to) {
        setHistory(result.members); setError('');
      }
    } catch (cause) {
      if (requestId === historyRequestId.current) { setHistory([]); setError(errorMessage(cause, 'Không tải được biểu đồ.')); }
    }
  };

  useEffect(() => {
    void loadDashboard();
    const refresh = setInterval(() => void loadDashboard(), 30_000);
    const timer = setInterval(() => setTick(Date.now()), 1_000);
    return () => { clearInterval(refresh); clearInterval(timer); };
  }, []);
  useEffect(() => {
    void loadHistory();
    const refresh = setInterval(() => void loadHistory(), 30_000);
    return () => clearInterval(refresh);
  }, [from, to]);

  const me = members.find((member) => member.id === account.id);
  const selected = history.find((member) => member.id === selectedMemberId) ?? history.find((member) => member.id === account.id) ?? history[0];
  const live = useMemo(() => me?.openSince ? Math.max(0, tick - Date.parse(me.openSince)) : 0, [me?.openSince, tick]);
  const toggle = async () => {
    setBusy(true);
    try { if (me?.isOnline) await api.checkOut(); else await api.checkIn(); await Promise.all([loadDashboard(), loadHistory()]); }
    catch (cause) { setError(errorMessage(cause, 'Không thể chấm công.')); }
    finally { setBusy(false); }
  };
  const usePreset = (days: number) => { setTo(today); setFrom(vietnamDate(addDays(new Date(`${today}T12:00:00+07:00`), -(days - 1)))); };

  return <div className="space-y-7">
    <section className="hero-card"><div><p className="eyebrow">Hôm nay bạn thế nào?</p><h2 className="mt-2 text-3xl font-semibold">Xin chào, {account.name}</h2><p className="mt-2 text-slate-400">{me?.isOnline ? 'Bạn đang trong một phiên làm việc.' : 'Sẵn sàng bắt đầu phiên làm việc mới.'}</p></div><button className={`check-button ${me?.isOnline ? 'check-out' : 'check-in'}`} onClick={toggle} disabled={busy}>{me?.isOnline ? <LogOut/> : <LogIn/>}<span>{busy ? 'Đang xử lý…' : me?.isOnline ? 'Check out' : 'Check in'}</span></button></section>
    {error && <ErrorText text={error}/>}<div className="grid gap-4 md:grid-cols-3"><Metric icon={<Clock3/>} label="Tổng đã hoàn tất" value={formatDuration(me?.completedMilliseconds ?? 0)}/><Metric icon={<RefreshCw/>} label="Phiên hiện tại" value={me?.isOnline ? formatDuration(live) : 'Chưa online'}/><Metric icon={<Users/>} label="Thành viên hoạt động" value={`${members.length} người`}/></div>

    <section className="panel analytics-panel">
      <div className="panel-heading analytics-heading"><div><p className="eyebrow">Phân tích hoạt động</p><h3>Thống kê theo khoảng thời gian</h3></div><div className="range-presets"><button onClick={() => usePreset(3)}>3 ngày</button><button onClick={() => usePreset(7)}>7 ngày</button><button onClick={() => usePreset(30)}>30 ngày</button></div></div>
      <div className="analytics-filters">
        <label>Thành viên<select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>{history.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label>Từ ngày<input aria-label="Từ ngày" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)}/></label>
        <label>Đến ngày<input aria-label="Đến ngày" type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)}/></label>
      </div>
      <div className="charts-grid"><BarChart days={selected?.days ?? []}/><LineChart days={selected?.days ?? []}/></div>
    </section>

    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Toàn đội</p><h3>Bảng đối chiếu tích lũy</h3></div><button className="icon-button" onClick={() => void Promise.all([loadDashboard(), loadHistory()])} aria-label="Làm mới"><RefreshCw size={18}/></button></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Thành viên</th><th>Trạng thái</th><th className="text-right">Tổng thời gian</th></tr></thead><tbody>{members.map((member, index) => <tr key={member.id}><td className="rank">{String(index + 1).padStart(2, '0')}</td><td><div className="member-cell"><span className="avatar">{initials(member.name)}</span><span>{member.name}{member.id === account.id && <small>Bạn</small>}</span></div></td><td><span className={`status ${member.isOnline ? 'online' : ''}`}><i/>{member.isOnline ? 'Online' : 'Offline'}</span></td><td className="text-right tabular-nums font-medium">{formatDuration(member.completedMilliseconds)}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function BarChart({ days }: { days: AttendanceHistoryDay[] }) {
  const [hovered, setHovered] = useState<AttendanceHistoryDay | null>(null);
  const max = Math.max(...days.map((day) => Math.abs(day.durationMilliseconds)), 1);
  return <article className="chart-card"><div className="chart-title"><p>So sánh từng ngày</p><h3>Thời gian online theo ngày</h3></div><div className="bar-scroll"><div className="bar-chart" style={{ minWidth: `${Math.max(300, days.length * 46)}px` }}>{days.map((day) => <button key={day.date} className={`bar-item ${day.durationMilliseconds < 0 ? 'negative' : ''}`} aria-label={dayLabel(day)} onMouseEnter={() => setHovered(day)} onFocus={() => setHovered(day)} onMouseLeave={() => setHovered(null)} onBlur={() => setHovered(null)}><span className="bar-value">{chartDuration(day.durationMilliseconds, true)}</span><i style={{ height: `${Math.max(3, Math.abs(day.durationMilliseconds) / max * 100)}%` }}/><small>{shortDate(day.date)}</small></button>)}</div></div>{hovered && <ChartTooltip day={hovered}/>}</article>;
}

function LineChart({ days }: { days: AttendanceHistoryDay[] }) {
  const [hovered, setHovered] = useState<AttendanceHistoryDay | null>(null);
  const width = Math.max(600, days.length * 32); const height = 220; const padding = 28;
  const maximum = Math.max(0, ...days.map((day) => day.durationMilliseconds));
  const minimum = Math.min(0, ...days.map((day) => day.durationMilliseconds));
  const range = Math.max(1, maximum - minimum);
  const yFor = (value: number) => padding + (maximum - value) / range * (height - padding * 2);
  const baseline = yFor(0);
  const points = days.map((day, index) => ({ day, x: days.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (days.length - 1), y: yFor(day.durationMilliseconds) }));
  return <article className="chart-card"><div className="chart-title"><p>Biến động trong kỳ</p><h3>Xu hướng online</h3></div><div className="line-wrap"><svg width={width} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ đường thời gian online"><defs><linearGradient id="line-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity=".28"/><stop offset="1" stopColor="#22d3ee" stopOpacity="0"/></linearGradient></defs><line className="line-zero" x1={padding} x2={width - padding} y1={baseline} y2={baseline}/>{points.length > 1 && <><path className="line-area" d={`M ${points[0].x} ${baseline} L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${points.at(-1)!.x} ${baseline} Z`}/><polyline className="line-path" points={points.map((point) => `${point.x},${point.y}`).join(' ')}/></>}{points.map(({ day, x, y }) => <g key={day.date}><circle className="line-hit" cx={x} cy={y} r="15" tabIndex={0} aria-label={dayLabel(day)} onMouseEnter={() => setHovered(day)} onFocus={() => setHovered(day)} onMouseLeave={() => setHovered(null)} onBlur={() => setHovered(null)}/><circle className={`line-dot ${day.durationMilliseconds < 0 ? 'negative' : ''}`} cx={x} cy={y} r="5"/><text x={x} y={height - 7} textAnchor="middle">{shortDate(day.date)}</text></g>)}</svg></div>{hovered && <ChartTooltip day={hovered}/>}</article>;
}

function ChartTooltip({ day }: { day: AttendanceHistoryDay }) { return <div className="chart-tooltip" role="status"><strong>{formatDate(day.date)}</strong><span>{chartDuration(day.durationMilliseconds)}</span><span>{day.sessionCount} phiên làm việc</span><span>Điều chỉnh: {signedDuration(day.adjustmentMilliseconds)}</span></div>; }
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="metric"><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></div>; }
export function formatDuration(ms: number) { const minutes = Math.max(0, Math.floor(ms / 60_000)); const days = Math.floor(minutes / 1_440); const hours = Math.floor((minutes % 1_440) / 60); const rest = minutes % 60; return days ? `${days} ngày ${hours} giờ ${rest} phút` : `${hours} giờ ${rest} phút`; }
function signedDuration(ms: number) { return `${ms >= 0 ? '+' : '−'}${formatDuration(Math.abs(ms))}`; }
function chartDuration(ms: number, short = false) { if (short) { const hours = Math.abs(ms) / 3_600_000; return `${ms < 0 ? '−' : ''}${hours >= 10 ? Math.round(hours) : hours.toFixed(hours % 1 ? 1 : 0)}h`; } return `${ms < 0 ? '−' : ''}${formatDuration(Math.abs(ms))}`; }
function shortDate(date: string) { const [, month, day] = date.split('-'); return `${day}/${month}`; }
function formatDate(date: string) { const [year, month, day] = date.split('-'); return `${day}/${month}/${year}`; }
function dayLabel(day: AttendanceHistoryDay) { return `${formatDate(day.date)}: ${chartDuration(day.durationMilliseconds)}`; }
function initials(name: string) { return name.split(' ').slice(-2).map((part) => part[0]).join('').toUpperCase(); }
function addDays(date: Date, amount: number) { return new Date(date.getTime() + amount * 86_400_000); }
function vietnamDate(date: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function errorMessage(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
