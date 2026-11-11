import { useEffect, useState } from 'react';
import { NavLink, useParams, Navigate, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useForm } from 'react-hook-form';
import { Monitor, Smartphone, ShieldCheck, ShieldOff, Copy, LogOut } from 'lucide-react';
import { WHO_CAN, VISIBILITY, AUDIENCES, AUDIENCE_LABELS } from '@shared/constants.js';
import { authApi, profileApi } from '../../api/index.js';
import { errorMessage, fieldErrors } from '../../api/http.js';
import { Field, Spinner, Modal, Skeleton, Empty, ConfirmDialog, Avatar } from '../../components/ui/index.jsx';
import { StrengthMeter } from '../auth/Auth.jsx';
import { useCurrentUser, useTheme, useTitle, useToast } from '../../lib/hooks.js';
import { signedOut, userUpdated, logout } from '../../store/slices.js';
import { setAccessToken } from '../../api/http.js';
import { fullDate } from '../../lib/format.js';

const SECTIONS = [['account', 'Account'], ['privacy', 'Privacy'], ['notifications', 'Notifications'], ['security', 'Security'], ['blocked', 'Blocked & restricted'], ['danger', 'Deactivate or delete']];
const Section = ({ title, children, desc }) => <section className="card space-y-4 p-5"><div><h2 className="font-bold">{title}</h2>{desc && <p className="text-sm text-mute">{desc}</p>}</div>{children}</section>;
const cap = (s) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function Toggle({ label, checked, onChange, desc }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span><span className="block text-sm font-medium">{label}</span>{desc && <span className="text-xs text-mute">{desc}</span>}</span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full bg-line transition peer-checked:bg-brand-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand-500 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

function Account() {
  const me = useCurrentUser();
  const dispatch = useDispatch();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { username: me.username } });
  const save = async ({ username }) => {
    try { const r = await profileApi.changeUsername(username.trim().toLowerCase()); dispatch(userUpdated(r.user || { username: username.trim().toLowerCase() })); toast('Username updated', 'success'); }
    catch (e) { setError('username', { message: fieldErrors(e).username || errorMessage(e) }); }
  };
  return (
    <>
      <Section title="Profile" desc="Your name, photo and bio are edited from your profile page.">
        <div className="flex items-center gap-3"><Avatar user={me} size={52} /><div><p className="font-semibold">{me.name}</p><p className="text-sm text-mute">{me.email}</p></div></div>
      </Section>
      <Section title="Username" desc="Your profile link changes with it.">
        <form onSubmit={handleSubmit(save)} className="flex flex-wrap items-start gap-3" noValidate>
          <div className="min-w-[14rem] flex-1"><Field error={errors.username?.message}><input aria-label="Username" className="input" {...register('username', { required: 'Choose a username', pattern: { value: /^[A-Za-z0-9_]{3,30}$/, message: '3–30 letters, numbers or underscores' } })} /></Field></div>
          <button className="btn-primary" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}Save</button>
        </form>
      </Section>
      <Section title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {['light', 'dark', 'system'].map((t) => <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'btn-primary' : 'btn-soft'} onClick={() => setTheme(t)}>{cap(t)}</button>)}
        </div>
      </Section>
    </>
  );
}

function Privacy() {
  const toast = useToast();
  const [p, setP] = useState(null);
  useEffect(() => { profileApi.privacy().then(setP).catch((e) => toast(errorMessage(e), 'error')); }, []); // eslint-disable-line
  if (!p) return <Skeleton className="h-64 w-full" />;
  const set = async (key, value) => {
    const prev = p;
    setP({ ...p, [key]: value });
    try { await profileApi.updatePrivacy({ [key]: value }); } catch (e) { setP(prev); toast(errorMessage(e), 'error'); }
  };
  const select = (key, label, options, fmt = cap) => (
    <Field label={label}><select className="input" value={p[key]} onChange={(e) => set(key, e.target.value)}>{options.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}</select></Field>
  );
  return (
    <>
      <Section title="Who can see your things">
        <div className="grid gap-4 sm:grid-cols-2">
          {select('profileVisibility', 'Your profile', VISIBILITY, (o) => ({ everyone: 'Everyone', friends: 'Friends only', only_me: 'Only me' }[o]))}
          {select('aboutVisibility', 'Your About details', VISIBILITY, (o) => ({ everyone: 'Everyone', friends: 'Friends only', only_me: 'Only me' }[o]))}
          {select('friendListVisibility', 'Your friend list', VISIBILITY, (o) => ({ everyone: 'Everyone', friends: 'Friends only', only_me: 'Only me' }[o]))}
          {select('birthdayVisibility', 'Your birthday', VISIBILITY, (o) => ({ everyone: 'Everyone', friends: 'Friends only', only_me: 'Only me' }[o]))}
          {select('defaultPostAudience', 'Default audience for new posts', AUDIENCES.filter((a) => !['friends_except', 'specific'].includes(a)), (a) => AUDIENCE_LABELS[a])}
        </div>
      </Section>
      <Section title="Who can interact with you">
        <div className="grid gap-4 sm:grid-cols-2">
          {select('whoCanSendFriendRequests', 'Send you friend requests', ['everyone', 'nobody'], (o) => (o === 'everyone' ? 'Everyone' : 'Nobody'))}
          {select('whoCanFollow', 'Follow you', ['everyone', 'nobody'], (o) => (o === 'everyone' ? 'Everyone' : 'Only friends'))}
          {select('whoCanTag', 'Tag you in posts', WHO_CAN)}
          {select('whoCanComment', 'Comment on your posts', WHO_CAN)}
        </div>
        <Toggle label="Show when you're online" checked={p.showOnlineStatus} onChange={(v) => set('showOnlineStatus', v)} />
      </Section>
    </>
  );
}

const NOTIF = [['friend_request', 'Friend requests'], ['friend_accept', 'Accepted requests'], ['follow', 'New followers'], ['reaction', 'Reactions'], ['comment', 'Comments'], ['reply', 'Replies'], ['mention', 'Mentions'], ['tag', 'Tags'], ['share', 'Shares']];
function Notifications() {
  const me = useCurrentUser();
  const dispatch = useDispatch();
  const toast = useToast();
  const prefs = me.notificationPrefs || {};
  const set = async (k, v) => {
    const prev = prefs;
    dispatch(userUpdated({ notificationPrefs: { ...prefs, [k]: v } }));
    try { await profileApi.updateNotificationPrefs({ [k]: v }); } catch (e) { dispatch(userUpdated({ notificationPrefs: prev })); toast(errorMessage(e), 'error'); }
  };
  return (
    <>
      <Section title="In-app notifications" desc="Choose what shows up in your notification list and as live pop-ups.">
        {NOTIF.map(([k, l]) => <Toggle key={k} label={l} checked={prefs[k] !== false} onChange={(v) => set(k, v)} />)}
      </Section>
      <Section title="Email"><Toggle label="Friend request emails" checked={prefs.emailFriendRequests} onChange={(v) => set('emailFriendRequests', v)} />
        <Toggle label="Security alerts" desc="New sign-ins and password changes" checked={prefs.emailSecurityAlerts !== false} onChange={(v) => set('emailSecurityAlerts', v)} /></Section>
    </>
  );
}

function ChangePassword() {
  const toast = useToast();
  const { register, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm();
  const submit = async (v) => {
    try { await authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }); reset(); toast('Password changed. Other devices were signed out.', 'success'); }
    catch (e) { setError('currentPassword', { message: errorMessage(e) }); }
  };
  return (
    <Section title="Change password">
      <form onSubmit={handleSubmit(submit)} className="max-w-sm space-y-3" noValidate>
        <Field label="Current password" error={errors.currentPassword?.message}><input className="input" type="password" autoComplete="current-password" {...register('currentPassword', { required: 'Enter your current password' })} /></Field>
        <Field label="New password" error={errors.newPassword?.message}><input className="input" type="password" autoComplete="new-password" {...register('newPassword', { required: 'Choose a new password', minLength: { value: 8, message: 'Use at least 8 characters' }, validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Use at least one letter and one number' })} /><StrengthMeter value={watch('newPassword')} /></Field>
        <button className="btn-primary" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}Update password</button>
      </form>
    </Section>
  );
}

function TwoFactor() {
  const me = useCurrentUser();
  const dispatch = useDispatch();
  const toast = useToast();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [disable, setDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dis, setDis] = useState({ password: '', code: '' });
  const start = async () => { try { setSetup(await authApi.twoFactorSetup()); } catch (e) { toast(errorMessage(e), 'error'); } };
  const enable = async () => {
    setBusy(true);
    try { const r = await authApi.twoFactorEnable(code); setRecovery(r.recoveryCodes); setSetup(null); setCode(''); dispatch(userUpdated({ twoFactorEnabled: true })); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try { await authApi.twoFactorDisable(dis); dispatch(userUpdated({ twoFactorEnabled: false })); setDisable(false); setDis({ password: '', code: '' }); toast('Two-factor authentication is off', 'success'); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Section title="Two-factor authentication" desc="Require a code from an authenticator app (Google Authenticator, 1Password, Authy…) when you log in.">
      <div className="flex items-center gap-3">
        {me.twoFactorEnabled ? <ShieldCheck className="h-6 w-6 text-emerald-500" /> : <ShieldOff className="h-6 w-6 text-mute" />}
        <span className="text-sm font-medium">{me.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</span>
        {me.twoFactorEnabled ? <button className="btn-soft ml-auto" onClick={() => setDisable(true)}>Turn off</button> : !setup && <button className="btn-primary ml-auto" onClick={start}>Set up</button>}
      </div>
      {setup && (
        <div className="space-y-3 rounded-xl bg-line/40 p-4 text-sm">
          <p>1. In your authenticator app, add an account using this key (choose “time-based”):</p>
          <p className="flex items-center gap-2"><code className="break-all rounded bg-surface px-2 py-1 font-mono text-xs tracking-wider" data-testid="totp-secret">{setup.secret}</code>
            <button className="btn-ghost !p-1.5" aria-label="Copy key" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast('Key copied', 'success'))}><Copy className="h-4 w-4" /></button></p>
          <p>Or <a className="font-semibold text-brand-600 underline" href={setup.otpauthUrl}>open it in your authenticator app</a> on this device.</p>
          <p>2. Enter the 6-digit code it shows:</p>
          <div className="flex gap-2"><input className="input max-w-[10rem] tracking-widest" inputMode="numeric" maxLength={6} aria-label="Authentication code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary" disabled={code.length !== 6 || busy} onClick={enable}>{busy && <Spinner className="h-4 w-4" />}Turn on</button>
            <button className="btn-ghost" onClick={() => setSetup(null)}>Cancel</button></div>
        </div>
      )}
      <Modal open={!!recovery} onClose={() => setRecovery(null)} title="Save your recovery codes" footer={<button className="btn-primary" onClick={() => setRecovery(null)}>I've saved them</button>}>
        <p className="mb-3 text-sm text-mute">Each code works once if you lose your authenticator. They will not be shown again.</p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">{recovery?.map((c) => <li key={c} className="rounded bg-line/50 px-3 py-1.5">{c}</li>)}</ul>
        <button className="btn-soft mt-3" onClick={() => navigator.clipboard?.writeText(recovery.join('\n'))}><Copy className="h-4 w-4" />Copy all</button>
      </Modal>
      <Modal open={disable} onClose={() => setDisable(false)} title="Turn off two-factor" footer={<><button className="btn-ghost" onClick={() => setDisable(false)}>Cancel</button><button className="btn-danger" disabled={busy || !dis.password || !dis.code} onClick={turnOff}>Turn off</button></>}>
        <div className="space-y-3"><Field label="Password"><input className="input" type="password" value={dis.password} onChange={(e) => setDis({ ...dis, password: e.target.value })} /></Field>
          <Field label="Authentication or recovery code"><input className="input" value={dis.code} onChange={(e) => setDis({ ...dis, code: e.target.value })} /></Field></div>
      </Modal>
    </Section>
  );
}

function Sessions() {
  const toast = useToast();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [history, setHistory] = useState(null);
  const load = () => { authApi.sessions().then((r) => setRows(r.items)).catch((e) => toast(errorMessage(e), 'error')); authApi.history().then((r) => setHistory(r.items)).catch(() => setHistory([])); };
  useEffect(load, []); // eslint-disable-line
  const revoke = async (s) => { try { await authApi.revokeSession(s.family); setRows((r) => r.filter((x) => x.family !== s.family)); toast('Device signed out', 'success'); } catch (e) { toast(errorMessage(e), 'error'); } };
  const all = async () => { try { await authApi.logoutAll(); setAccessToken(null); dispatch(signedOut()); navigate('/login'); } catch (e) { toast(errorMessage(e), 'error'); } };
  return (
    <>
      <Section title="Where you're signed in">
        {!rows ? <Skeleton className="h-24 w-full" /> : (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.family} className="flex items-center gap-3 py-3">
                {/Mobile|Android|iPhone/i.test(s.device) ? <Smartphone className="h-5 w-5 text-mute" /> : <Monitor className="h-5 w-5 text-mute" />}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{s.device}{s.current && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">This device</span>}</p>
                  <p className="text-xs text-mute">{s.ip} · last active {fullDate(s.lastUsedAt)}</p></div>
                {!s.current && <button className="btn-soft !py-1.5" onClick={() => revoke(s)}><LogOut className="h-4 w-4" />Sign out</button>}
              </li>))}
          </ul>
        )}
        <button className="btn-soft" onClick={all}>Sign out of all devices</button>
      </Section>
      <Section title="Recent sign-in activity">
        {!history ? <Skeleton className="h-24 w-full" /> : history.length ? (
          <ul className="divide-y divide-line text-sm">{history.slice(0, 10).map((h) => (
            <li key={h._id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{h.device} <span className="text-mute">· {h.ip}</span></span>
              <span className={h.success ? 'text-mute' : 'font-medium text-red-600'}>{h.success ? '' : 'Failed · '}{fullDate(h.createdAt)}</span></li>))}</ul>
        ) : <p className="text-sm text-mute">No activity yet.</p>}
      </Section>
    </>
  );
}

function Blocked() {
  const toast = useToast();
  const [lists, setLists] = useState(null);
  const load = () => Promise.all([profileApi.blocked('block'), profileApi.blocked('restrict')]).then(([b, r]) => setLists({ block: b.items, restrict: r.items })).catch((e) => toast(errorMessage(e), 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const undo = async (u) => { try { await profileApi.unblock(u._id); await load(); toast('Updated', 'success'); } catch (e) { toast(errorMessage(e), 'error'); } };
  if (!lists) return <Skeleton className="h-40 w-full" />;
  const block = (title, items, label) => (
    <Section title={title}>
      {items.length ? <ul className="divide-y divide-line">{items.map((u) => <li key={u._id} className="flex items-center gap-3 py-2"><Avatar user={u} size={36} /><span className="flex-1 text-sm font-medium">{u.name} <span className="text-mute">@{u.username}</span></span><button className="btn-soft !py-1.5" onClick={() => undo(u)}>{label}</button></li>)}</ul> : <p className="text-sm text-mute">Nobody here.</p>}
    </Section>
  );
  return <>{block('Blocked people', lists.block, 'Unblock')}{block('Restricted people', lists.restrict, 'Unrestrict')}</>;
}

function Danger() {
  const dispatch = useDispatch();
  const [mode, setMode] = useState(null);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try { await (mode === 'delete' ? authApi.deleteAccount(password) : authApi.deactivate(password)); setAccessToken(null); dispatch(signedOut()); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Section title="Deactivate account" desc="Hide your profile and posts. Log in again any time to come back."><button className="btn-soft" onClick={() => setMode('deactivate')}>Deactivate…</button></Section>
      <Section title="Delete account" desc="Permanently delete your profile, posts, comments and messages. This cannot be undone."><button className="btn-danger" onClick={() => setMode('delete')}>Delete account…</button></Section>
      <Modal open={!!mode} onClose={() => { setMode(null); setPassword(''); setErr(''); }} title={mode === 'delete' ? 'Delete your account?' : 'Deactivate your account?'} footer={<><button className="btn-ghost" onClick={() => setMode(null)}>Cancel</button><button className="btn-danger" disabled={!password || busy} onClick={go}>{busy && <Spinner className="h-4 w-4" />}{mode === 'delete' ? 'Delete forever' : 'Deactivate'}</button></>}>
        <Field label="Confirm with your password" error={err}><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

const PAGES = { account: Account, privacy: Privacy, notifications: Notifications, security: () => <><ChangePassword /><TwoFactor /><Sessions /></>, blocked: Blocked, danger: Danger };

export default function Settings() {
  const { section = 'account' } = useParams();
  useTitle('Settings');
  const Page = PAGES[section];
  if (!Page) return <Navigate to="/settings" replace />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>
      <div className="flex flex-col gap-4 md:flex-row">
        <nav aria-label="Settings sections" className="card flex shrink-0 gap-1 overflow-x-auto p-2 md:w-56 md:flex-col">
          {SECTIONS.map(([id, label]) => <NavLink key={id} to={`/settings/${id}`} className={({ isActive }) => `whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100' : 'text-mute hover:bg-line/50'}`}>{label}</NavLink>)}
        </nav>
        <div className="min-w-0 flex-1 space-y-4"><Page /></div>
      </div>
    </div>
  );
}
