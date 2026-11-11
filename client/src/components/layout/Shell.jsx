import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Home, Compass, Users, Bell, Bookmark, Settings, Search, Moon, Sun, Monitor, LogOut, Shield, User as UserIcon, Hash, MessageCircle } from 'lucide-react';
import { Avatar, Menu } from '../ui/index.jsx';
import { logout } from '../../store/slices.js';
import { useCurrentUser, useDebounced, useTheme } from '../../lib/hooks.js';
import { searchApi } from '../../api/index.js';

function SearchBox() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sug, setSug] = useState({ people: [], hashtags: [] });
  const dq = useDebounced(q.trim(), 200);
  const ref = useRef(null);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (dq.length < 2) { setSug({ people: [], hashtags: [] }); return undefined; }
    let live = true;
    searchApi.suggest(dq).then((r) => live && setSug({ people: r.people || [], hashtags: r.hashtags || [] })).catch(() => {});
    return () => { live = false; };
  }, [dq]);
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const go = (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    searchApi.addRecent(q.trim()).catch(() => {});
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  };
  const has = sug.people.length || sug.hashtags.length;
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <form onSubmit={go} role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
        <input className="input !rounded-full !bg-line/50 !py-2 pl-9" type="search" aria-label="Search Circle" placeholder="Search people, posts, #tags" value={q} maxLength={80}
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      </form>
      {open && dq.length >= 2 && has > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
          {sug.people.slice(0, 5).map((p) => (
            <Link key={p._id} to={`/u/${p.username}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-line/50"><Avatar user={p} size={28} />{p.name}<span className="text-mute">@{p.username}</span></Link>
          ))}
          {sug.hashtags.slice(0, 3).map((h) => (
            <Link key={h.tag || h} to={`/hashtag/${h.tag || h}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-line/50"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-line"><Hash className="h-4 w-4" /></span>#{h.tag || h}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/friends', label: 'Friends', icon: Users },
  { to: '/messages', label: 'Messages', icon: MessageCircle, chat: true },
  { to: '/notifications', label: 'Notifications', short: 'Alerts', icon: Bell, badge: true },
  { to: '/saved', label: 'Saved', icon: Bookmark },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Shell() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const unread = useSelector((s) => s.notifications.unread);
  const chatUnread = useSelector((s) => s.chat.unread);
  const count = (n) => (n.badge ? unread : n.chat ? chatUnread : 0);
  const [theme, setTheme] = useTheme();
  const staff = ['admin', 'moderator'].includes(me?.role);
  const nextTheme = { light: 'dark', dark: 'system', system: 'light' }[theme];
  const ThemeIcon = { light: Sun, dark: Moon, system: Monitor }[theme];
  const link = ({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100' : 'text-mute hover:bg-line/50 hover:text-ink'}`;

  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-brand-600" aria-label="Circle home">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-brand-600"><span className="h-2 w-2 rounded-full bg-brand-600" /></span>
            <span className="hidden sm:inline">Circle</span>
          </Link>
          <div className="flex flex-1 justify-center"><SearchBox /></div>
          <button className="btn-ghost !p-2" onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`} title={`Theme: ${theme}`}><ThemeIcon className="h-5 w-5" /></button>
          <Menu label="Account menu" trigger={<Avatar user={me} size={30} />} items={[
            { label: 'My profile', icon: UserIcon, onClick: () => navigate(`/u/${me.username}`) },
            { label: 'Settings', icon: Settings, onClick: () => navigate('/settings') },
            { label: 'Moderation', icon: Shield, onClick: () => navigate('/admin'), hidden: !staff },
            { label: 'Log out', icon: LogOut, onClick: () => dispatch(logout()), danger: true },
          ]} />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-3 pb-24 pt-4 sm:px-4 lg:pb-8">
        <aside className="sticky top-[4.5rem] hidden h-fit w-60 shrink-0 lg:block" aria-label="Primary">
          <nav className="space-y-1">
            <NavLink to={`/u/${me.username}`} className={link}><Avatar user={me} size={26} />{me.name}</NavLink>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                <n.icon className="h-5 w-5" />{n.label}
                {count(n) > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{count(n) > 99 ? '99+' : count(n)}</span>}
              </NavLink>
            ))}
            {staff && <NavLink to="/admin" className={link}><Shield className="h-5 w-5" />Moderation</NavLink>}
          </nav>
        </aside>
        <main id="main" className="min-w-0 flex-1"><Outlet /></main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary mobile">
        {[NAV[0], NAV[1], NAV[2], NAV[3], NAV[4], { to: `/u/${me.username}`, label: 'Profile', icon: UserIcon }].map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${isActive ? 'text-brand-600' : 'text-mute'}`}>
            <n.icon className="h-6 w-6" /><span className="max-w-full truncate">{n.short || n.label}</span>
            {count(n) > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{count(n) > 9 ? '9+' : count(n)}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
