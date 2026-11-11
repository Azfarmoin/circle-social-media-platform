import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Users, Bell, BellOff, Trash2, CheckCheck } from 'lucide-react';
import { friendApi, notificationApi } from '../api/index.js';
import { errorMessage } from '../api/http.js';
import { useInfinite, useTitle, useToast } from '../lib/hooks.js';
import { Avatar, Empty, ErrorState, Spinner, Tabs, Skeleton } from '../components/ui/index.jsx';
import Sentinel from '../components/ui/Sentinel.jsx';
import PersonRow from '../components/people/PersonRow.jsx';
import FriendActions from '../components/people/FriendActions.jsx';
import { timeAgo } from '../lib/format.js';
import { notificationText, notificationLink } from '../lib/notifications.js';
import { clearUnread, decrement } from '../store/slices.js';

function Rows({ list, render, emptyNode }) {
  return (
    <div className="card divide-y divide-line px-4">
      {list.items.map(render)}
      {list.loading && !list.items.length && <div className="space-y-3 py-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
      {list.empty && emptyNode}
      {list.error && <div className="py-4"><ErrorState message={list.error} onRetry={list.reload} /></div>}
      <Sentinel loading={list.loading && list.items.length > 0} done={list.done} error={list.error} onMore={list.loadMore} />
    </div>
  );
}

export function Friends() {
  useTitle('Friends');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'requests';
  const toast = useToast();
  const requests = useInfinite((cursor) => friendApi.requests({ direction: 'incoming', cursor, limit: 20 }), [tab === 'requests']);
  const sent = useInfinite((cursor) => friendApi.requests({ direction: 'outgoing', cursor, limit: 20 }), [tab === 'sent']);
  const all = useInfinite((cursor) => friendApi.list({ cursor, limit: 24 }), [tab === 'all']);
  const [sug, setSug] = useState(null);
  useEffect(() => { if (tab === 'suggestions') friendApi.suggestions(24).then((r) => setSug(r.items)).catch((e) => { toast(errorMessage(e), 'error'); setSug([]); }); }, [tab]); // eslint-disable-line

  const answer = async (list, r, fn) => {
    try { await fn(r._id); list.setItems((c) => c.filter((x) => x._id !== r._id)); toast('Done', 'success'); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Friends</h1>
      <div className="card px-2"><Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ id: 'requests', label: 'Requests' }, { id: 'suggestions', label: 'Suggestions' }, { id: 'all', label: 'All friends' }, { id: 'sent', label: 'Sent' }]} /></div>
      {tab === 'requests' && (
        <Rows list={requests} emptyNode={<p className="py-10 text-center text-sm text-mute">No pending friend requests.</p>}
          render={(r) => <PersonRow key={r._id} user={r.user} sub={`Sent ${timeAgo(r.createdAt)} ago`} action={
            <span className="flex gap-2"><button className="btn-primary !px-3 !py-1.5" onClick={() => answer(requests, r, friendApi.accept)}>Confirm</button><button className="btn-ghost !px-3 !py-1.5" onClick={() => answer(requests, r, friendApi.reject)}>Delete</button></span>} />} />
      )}
      {tab === 'sent' && (
        <Rows list={sent} emptyNode={<p className="py-10 text-center text-sm text-mute">You have no outgoing requests.</p>}
          render={(r) => <PersonRow key={r._id} user={r.user} sub={`Sent ${timeAgo(r.createdAt)} ago`} action={<button className="btn-soft !px-3 !py-1.5" onClick={() => answer(sent, r, friendApi.cancel)}>Cancel</button>} />} />
      )}
      {tab === 'all' && (
        <Rows list={all} emptyNode={<Empty icon={Users} title="No friends yet" hint="Check Suggestions to find people you may know." />}
          render={(u) => <PersonRow key={u._id} user={u} action={<FriendActions size="sm" userId={u._id} initial="friends" />} />} />
      )}
      {tab === 'suggestions' && (
        <div className="card divide-y divide-line px-4">
          {!sug && <div className="flex justify-center py-8"><Spinner /></div>}
          {sug?.map((u) => <PersonRow key={u._id} user={u} sub={u.mutualCount ? `${u.mutualCount} mutual friends` : u.bio || `@${u.username}`} action={<FriendActions size="sm" userId={u._id} />} />)}
          {sug && !sug.length && <p className="py-10 text-center text-sm text-mute">No suggestions right now.</p>}
        </div>
      )}
    </div>
  );
}

export function Notifications() {
  useTitle('Notifications');
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useInfinite((cursor) => notificationApi.list({ cursor, limit: 20, unread: unreadOnly ? 'true' : undefined }), [unreadOnly]);

  const open = async (n) => {
    if (!n.read) {
      list.setItems((c) => c.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      dispatch(decrement(1));
      notificationApi.read([n._id]).catch(() => {});
    }
    navigate(notificationLink(n));
  };
  const markAll = async () => {
    try { await notificationApi.read(); dispatch(clearUnread()); list.setItems((c) => c.map((x) => ({ ...x, read: true }))); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const remove = async (n) => {
    try { await notificationApi.remove(n._id); list.setItems((c) => c.filter((x) => x._id !== n._id)); if (!n.read) dispatch(decrement(1)); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  // live notifications from the socket are prepended while the page is open
  useEffect(() => {
    const onLive = (e) => list.setItems((c) => (c.some((x) => x._id === e.detail._id) ? c : [e.detail, ...c]));
    window.addEventListener('circle:notification', onLive);
    return () => window.removeEventListener('circle:notification', onLive);
  }, [list]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Notifications</h1>
        <button className="btn-soft" onClick={markAll}><CheckCheck className="h-4 w-4" />Mark all read</button></div>
      <div className="card px-2"><Tabs value={unreadOnly ? 'unread' : 'all'} onChange={(t) => setUnreadOnly(t === 'unread')} tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }]} /></div>
      <div className="card divide-y divide-line overflow-hidden">
        {list.items.map((n) => (
          <div key={n._id} className={`group flex items-center gap-3 px-4 py-3 ${n.read ? '' : 'bg-brand-50/60 dark:bg-brand-500/10'}`}>
            <button onClick={() => open(n)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Avatar user={n.actor} size={44} />
              <span className="min-w-0"><span className="block text-sm">{notificationText(n)}</span><span className="text-xs text-mute">{timeAgo(n.createdAt)} ago</span></span>
              {!n.read && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
            </button>
            <button className="btn-ghost !p-2 opacity-60 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100" aria-label="Delete notification" onClick={() => remove(n)}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {list.loading && !list.items.length && <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        {list.empty && <div className="p-4"><Empty icon={unreadOnly ? BellOff : Bell} title={unreadOnly ? "You're all caught up" : 'No notifications yet'} hint="Reactions, comments and friend requests will appear here." /></div>}
        {list.error && <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>}
        <Sentinel loading={list.loading && list.items.length > 0} done={list.done} error={list.error} onMore={list.loadMore} />
      </div>
    </div>
  );
}
