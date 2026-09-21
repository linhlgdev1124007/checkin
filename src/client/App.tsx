import { useEffect, useState } from 'react';
import { Activity, Archive, LogOut, Menu, ShieldCheck, Users, X } from 'lucide-react';
import { api as defaultApi, type Account, type Api } from './api.js';
import { AuthShell, KeyScreen, SetupScreen } from './components/AuthScreens.js';
import { AuditPanel, MembersPanel, OperationsPanel } from './components/Admin.js';
import { Dashboard } from './components/Dashboard.js';

type Stage = 'loading' | 'setup' | 'locked' | 'login' | 'app';
type View = 'dashboard' | 'members' | 'audit' | 'operations';

export function App({ api = defaultApi }: { api?: Api }) {
  const [stage, setStage] = useState<Stage>('loading'); const [account, setAccount] = useState<Account | null>(null); const [view, setView] = useState<View>('dashboard'); const [mobile, setMobile] = useState(false);
  useEffect(() => { void (async () => { try { const status = await api.status(); if (status.state === 'uninitialized') return setStage('setup'); if (status.state === 'locked') return setStage('locked'); try { const session = await api.session(); setAccount(session.account); setStage('app'); } catch { setStage('login'); } } catch { setStage('login'); } })(); }, [api]);
  const ready = (next: Account) => { setAccount(next); setStage('app'); };
  if (stage === 'loading') return <div className="loading"><ShieldCheck className="animate-pulse" size={36}/><span>Đang kiểm tra hệ thống…</span></div>;
  if (stage === 'setup') return <AuthShell><SetupScreen api={api} onReady={ready} onRestored={() => setStage('login')}/></AuthShell>;
  if (stage === 'locked') return <AuthShell><KeyScreen mode="unlock" api={api} onReady={ready}/></AuthShell>;
  if (stage === 'login' || !account) return <AuthShell><KeyScreen mode="login" api={api} onReady={ready}/></AuthShell>;
  const navigate = (next: View) => { setView(next); setMobile(false); };
  return <div className="app-shell"><aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}><div className="sidebar-brand"><ShieldCheck/><span>TEAM<br/><b>CHECK-IN</b></span><button className="lg:hidden ml-auto" onClick={() => setMobile(false)}><X/></button></div><nav><Nav active={view === 'dashboard'} onClick={() => navigate('dashboard')} icon={<Activity/>}>Tổng quan</Nav>{account.role === 'admin' && <><Nav active={view === 'members'} onClick={() => navigate('members')} icon={<Users/>}>Thành viên</Nav><Nav active={view === 'audit'} onClick={() => navigate('audit')} icon={<ShieldCheck/>}>Audit & điều chỉnh</Nav><Nav active={view === 'operations'} onClick={() => navigate('operations')} icon={<Archive/>}>Vận hành</Nav></>}</nav><div className="sidebar-user"><div><p>{account.name}</p><span>{account.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}</span></div><button aria-label="Đăng xuất" onClick={async () => { await api.logout(); setAccount(null); setStage('login'); }}><LogOut size={18}/></button></div></aside><main className="app-main"><header className="mobile-header"><button onClick={() => setMobile(true)}><Menu/></button><b>TEAM CHECK-IN</b><span className={`presence ${view === 'dashboard' ? 'active' : ''}`}/></header><div className="content"><div className="page-title"><p className="eyebrow">{view === 'dashboard' ? 'Workspace' : 'Quản trị'}</p><h1>{view === 'dashboard' ? 'Tổng quan' : view === 'members' ? 'Thành viên' : view === 'audit' ? 'Audit & điều chỉnh' : 'Vận hành'}</h1></div>{view === 'dashboard' && <Dashboard api={api} account={account}/>} {view === 'members' && <MembersPanel api={api}/>} {view === 'audit' && <AuditPanel api={api}/>} {view === 'operations' && <OperationsPanel api={api} onLocked={() => { setAccount(null); setStage('locked'); }}/>}</div></main>{mobile && <button className="sidebar-backdrop" aria-label="Đóng menu" onClick={() => setMobile(false)}/>}</div>;
}

function Nav({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{children}</span></button>; }
