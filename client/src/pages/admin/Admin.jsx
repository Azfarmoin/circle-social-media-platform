import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, FileText, MessageSquare, Flag, Activity, ShieldAlert, Server } from 'lucide-react';
import { adminApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { Tabs, Skeleton, Empty, ErrorState, Avatar, Verified, Menu, Spinner } from '../../components/ui/index.jsx';
import Sentinel from '../../components/ui/Sentinel.jsx';
import { useInfinite, useCurrentUser, useTitle, useToast, useDebounced } from '../../lib/hooks.js';
import { timeAgo, fullDate } from '../../lib/format.js';

const Stat = ({ icon: Icon, label, value }) => (
  <div className="card flex items-center gap-3 p-4"><span className="rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/15"><Icon className="h-5 w-5" /></span>
    <div><p className="text-2xl font-extrabold tabular-nums">{value ?? '–'}</p><p className="text-xs text-mute">{label}</p></div></div>
);

function Overview() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminApi.stats().then(setS).catch((e) => setErr(errorMessage(e))); }, []);
  if (err) return <ErrorState message={err} />;
  if (!s) return <Skeleton className="h-48 w-full" />;
  const t = s.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Users" value={t.users} /><Stat icon={Activity} label="Active this week" value={t.activeUsers} />
        <Stat icon={Users} label="New this week" value={t.newUsers} /><Stat icon={ShieldAlert} label="Suspended or banned" value={t.restrictedUsers} />
        <Stat icon={FileText} label="Posts" value={t.posts} /><Stat icon={MessageSquare} label="Comments" value={t.comments} />
        <Stat icon={Flag} label="Open reports" value={t.openReports} /><Stat icon={Server} label="Live sessions" value={t.liveSessions} />
      </div>
      <div className="card p-4 text-sm"><h2 className="mb-2 font-bold">System health</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">{Object.entries(s.health).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-mute">{k}</dt><dd className="font-medium">{String(v)}</dd></div>)}</dl></div>
    </div>
  );
}

function Reports() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const list = useInfinite((cursor) => adminApi.reports({ status, cursor, limit: 20 }), [status]);
  const resolve = async (r, st, removeContent) => {
    try { await adminApi.resolve(r._id, { status: st, removeContent }); list.setItems((c) => (status === 'all' ? c.map((x) => (x._id === r._id ? { ...x, status: st } : x)) : c.filter((x) => x._id !== r._id))); toast('Report updated', 'success'); }
    catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div className="space-y-3">
      <div className="card px-2"><Tabs value={status} onChange={setStatus} tabs={['open', 'resolved', 'dismissed', 'all'].map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1) }))} /></div>
      {list.items.map((r) => (
        <article key={r._id} className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold uppercase text-red-700 dark:bg-red-500/15 dark:text-red-300">{r.category.replace(/_/g, ' ')}</span>
            <span className="text-mute">{r.targetType} · reported {timeAgo(r.createdAt)} ago by {r.reporter ? `@${r.reporter.username}` : 'a deleted user'}</span><span className="ml-auto text-xs font-semibold uppercase text-mute">{r.status}</span></div>
          <p className="rounded-lg bg-line/40 p-3 text-sm">{r.preview ? (r.targetType === 'user' ? `${r.preview.name} (@${r.preview.username})` : r.preview.text || '(media post)') : 'Content no longer exists'}</p>
          {r.details && <p className="text-sm text-mute">“{r.details}”</p>}
          {r.status === 'open' && (
            <div className="flex flex-wrap gap-2">
              {r.targetType !== 'user' && r.preview && <button className="btn-danger !py-1.5" onClick={() => resolve(r, 'resolved', true)}>Remove content</button>}
              <button className="btn-soft !py-1.5" onClick={() => resolve(r, 'resolved', false)}>Mark resolved</button>
              <button className="btn-ghost !py-1.5" onClick={() => resolve(r, 'dismissed', false)}>Dismiss</button>
            </div>)}
        </article>
      ))}
      {list.loading && !list.items.length && <Skeleton className="h-32 w-full" />}
      {list.empty && <Empty icon={Flag} title="No reports here" hint="Nothing needs attention." />}
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      <Sentinel loading={list.loading} done={list.done} error={list.error} onMore={list.loadMore} />
    </div>
  );
}

function UsersTab() {
  const me = useCurrentUser();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const list = useInfinite((cursor) => adminApi.users({ q: dq, cursor, limit: 20 }), [dq]);
  const act = async (u, body) => {
    try { const r = await adminApi.moderate(u._id, body); list.setItems((c) => c.map((x) => (x._id === u._id ? { ...x, ...(r.user || r) } : x))); toast('User updated', 'success'); list.reload(); }
    catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div className="space-y-3">
      <input className="input" type="search" aria-label="Search users" placeholder="Search by name, username or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card divide-y divide-line px-4">
        {list.items.map((u) => (
          <div key={u._id} className="flex items-center gap-3 py-3">
            <Avatar user={u} size={40} />
            <div className="min-w-0 flex-1"><Link to={`/u/${u.username}`} className="font-semibold hover:underline">{u.name}</Link> <Verified user={u} />
              <p className="truncate text-xs text-mute">@{u.username} · {u.email} · joined {fullDate(u.createdAt)}</p></div>
            <span className="hidden text-xs font-semibold uppercase text-mute sm:block">{u.role}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${u.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'}`}>{u.status}</span>
            {u._id !== me._id && u.role !== 'admin' && (
              <Menu label={`Actions for ${u.name}`} trigger={<span className="px-1 text-lg leading-none">⋯</span>} items={[
                { label: 'Suspend', onClick: () => act(u, { action: 'suspend' }), hidden: u.status !== 'active' },
                { label: 'Ban', danger: true, onClick: () => act(u, { action: 'ban' }), hidden: u.status === 'banned' },
                { label: 'Reinstate', onClick: () => act(u, { action: 'reinstate' }), hidden: u.status === 'active' },
                { label: u.verifiedBadge ? 'Remove verified badge' : 'Give verified badge', onClick: () => act(u, { action: u.verifiedBadge ? 'unverify' : 'verify' }) },
                { label: u.role === 'moderator' ? 'Make regular user' : 'Make moderator', onClick: () => act(u, { action: 'set_role', role: u.role === 'moderator' ? 'user' : 'moderator' }), hidden: me.role !== 'admin' },
              ]} />)}
          </div>
        ))}
        {list.loading && <div className="flex justify-center py-6"><Spinner /></div>}
        {list.empty && <p className="py-8 text-center text-sm text-mute">No users match.</p>}
        <Sentinel loading={false} done={list.done} error={list.error} onMore={list.loadMore} />
      </div>
    </div>
  );
}

function Audit() {
  const list = useInfinite((cursor) => adminApi.audit({ cursor, limit: 25 }), []);
  return (
    <div className="card divide-y divide-line px-4 text-sm">
      {list.items.map((a) => <div key={a._id} className="flex flex-wrap justify-between gap-2 py-2.5"><span><b>{a.action}</b> <span className="text-mute">on {a.targetType} {String(a.target).slice(-6)}</span></span><span className="text-xs text-mute">{fullDate(a.createdAt)}</span></div>)}
      {list.empty && <p className="py-8 text-center text-mute">No moderation activity yet.</p>}
      <Sentinel loading={list.loading} done={list.done} error={list.error} onMore={list.loadMore} />
    </div>
  );
}

export default function Admin() {
  useTitle('Moderation');
  const me = useCurrentUser();
  const [tab, setTab] = useState('overview');
  if (!['admin', 'moderator'].includes(me.role)) return <Empty icon={ShieldAlert} title="Moderators only" hint="You don't have access to this area." />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Moderation</h1>
      <div className="card px-2"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'reports', label: 'Reports' }, { id: 'users', label: 'Users' }, { id: 'audit', label: 'Audit log' }]} /></div>
      {tab === 'overview' && <Overview />}{tab === 'reports' && <Reports />}{tab === 'users' && <UsersTab />}{tab === 'audit' && <Audit />}
    </div>
  );
}
