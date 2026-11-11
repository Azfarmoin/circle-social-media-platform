import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pin, Send, Trash2, Pencil, CornerDownRight, Flag } from 'lucide-react';
import { commentApi, reactionApi, postApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { getSocket } from '../../lib/socket.js';
import { timeAgo, fullDate, plural } from '../../lib/format.js';
import { Avatar, Verified, Spinner, ConfirmDialog, Menu } from '../ui/index.jsx';
import { RichText, ReactionButton, ReactionSummary } from './parts.jsx';
import { ReportModal, ReactionsModal } from './Modals.jsx';
import { useCurrentUser, useToast } from '../../lib/hooks.js';
import { LIMITS } from '@shared/constants.js';
import { useDispatch } from 'react-redux';
import { patchPost } from '../../store/slices.js';

function CommentForm({ postId, parentId, replyTo, onCreated, autoFocus, onCancel }) {
  const me = useCurrentUser();
  const toast = useToast();
  const [text, setText] = useState(replyTo ? `@${replyTo} ` : '');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) { ref.current?.focus(); const l = ref.current?.value.length || 0; ref.current?.setSelectionRange(l, l); } }, [autoFocus]);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await commentApi.create(postId, { text, ...(parentId ? { parentId } : {}) });
      setText('');
      onCreated(res);
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex items-start gap-2">
      <Avatar user={me} size={parentId ? 28 : 34} />
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-line/50 pr-1.5">
        <textarea ref={ref} rows={1} value={text} maxLength={LIMITS.commentText} aria-label={parentId ? 'Write a reply' : 'Write a comment'} placeholder={parentId ? 'Write a reply…' : 'Write a comment…'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); if (e.key === 'Escape') onCancel?.(); }}
          className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-3.5 py-2 text-sm outline-none placeholder:text-mute" />
        <button className="rounded-full p-2 text-brand-600 disabled:opacity-40" disabled={!text.trim() || busy} aria-label="Send">{busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}</button>
      </div>
    </form>
  );
}

function Comment({ c, postOwnerId, onChange, onDelete, depth = 0, postId }) {
  const me = useCurrentUser();
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(false);
  const [who, setWho] = useState(false);
  const [replies, setReplies] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const mine = me?._id === c.author._id;
  const canDelete = mine || me?._id === postOwnerId || ['admin', 'moderator'].includes(me?.role);

  const react = async (type) => {
    const prev = { myReaction: c.myReaction, reactionCounts: c.reactionCounts, reactionTotal: c.reactionTotal };
    const counts = { ...c.reactionCounts };
    if (c.myReaction) counts[c.myReaction] = Math.max(0, (counts[c.myReaction] || 0) - 1);
    if (type) counts[type] = (counts[type] || 0) + 1;
    onChange({ ...c, myReaction: type, reactionCounts: counts, reactionTotal: Object.values(counts).reduce((a, b) => a + b, 0) });
    try {
      const res = type ? await reactionApi.set('comment', c._id, type) : await reactionApi.remove('comment', c._id);
      onChange({ ...c, myReaction: res.myReaction, reactionCounts: res.reactionCounts, reactionTotal: res.reactionTotal });
    } catch (e) { onChange({ ...c, ...prev }); toast(errorMessage(e), 'error'); }
  };

  const loadReplies = async (more) => {
    setLoadingReplies(true);
    try {
      const res = await commentApi.replies(c._id, { limit: 10, cursor: more ? cursor : undefined });
      setReplies((r) => (more && r ? [...r, ...res.items.filter((x) => !r.some((y) => y._id === x._id))] : res.items));
      setCursor(res.nextCursor);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setLoadingReplies(false); }
  };

  // live reply arrivals for threads that are already open
  useEffect(() => {
    const s = getSocket();
    if (!s || depth) return undefined;
    const onNew = ({ comment }) => {
      if (comment?.parent === c._id) {
        setReplies((r) => (r && !r.some((x) => x._id === comment._id) ? [...r, comment] : r));
        onChange({ ...c, replyCount: (c.replyCount || 0) + 1 });
      }
    };
    const onDel = ({ commentId, parent }) => {
      if (parent === c._id) { setReplies((r) => r && r.filter((x) => x._id !== commentId)); onChange({ ...c, replyCount: Math.max(0, (c.replyCount || 1) - 1) }); }
    };
    s.on('comment:new', onNew); s.on('comment:delete', onDel);
    return () => { s.off('comment:new', onNew); s.off('comment:delete', onDel); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try { const res = await commentApi.edit(c._id, draft); onChange({ ...c, ...(res.comment || res) }); setEditing(false); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const pin = async () => {
    try { await commentApi.pin(c._id, !c.pinned); onChange({ ...c, pinned: !c.pinned }, true); } catch (e) { toast(errorMessage(e), 'error'); }
  };

  return (
    <li className="flex gap-2">
      <Link to={`/u/${c.author.username}`}><Avatar user={c.author} size={depth ? 28 : 34} /></Link>
      <div className="min-w-0 flex-1">
        <div className="group flex items-start gap-1">
          <div className="min-w-0 rounded-2xl bg-line/50 px-3.5 py-2 text-sm">
            <Link to={`/u/${c.author.username}`} className="font-semibold hover:underline">{c.author.name}</Link> <Verified user={c.author} />
            {c.pinned && <span className="ml-2 inline-flex items-center gap-1 text-xs text-mute"><Pin className="h-3 w-3" />Pinned</span>}
            {editing ? (
              <div className="mt-1 space-y-2">
                <textarea className="input" rows={2} maxLength={LIMITS.commentText} aria-label="Edit comment" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="flex gap-2"><button className="btn-primary !py-1" onClick={save} disabled={!draft.trim()}>Save</button><button className="btn-ghost !py-1" onClick={() => { setEditing(false); setDraft(c.text); }}>Cancel</button></div>
              </div>
            ) : <RichText text={c.text} />}
          </div>
          <Menu label="Comment options" trigger={<span className="text-lg leading-none">⋯</span>} items={[
            { label: c.pinned ? 'Unpin comment' : 'Pin comment', icon: Pin, onClick: pin, hidden: depth > 0 || me?._id !== postOwnerId },
            { label: 'Edit', icon: Pencil, onClick: () => setEditing(true), hidden: !mine },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirm(true), hidden: !canDelete },
            { label: 'Report', icon: Flag, onClick: () => setReport(true), hidden: mine },
          ]} />
        </div>
        <div className="mt-0.5 flex items-center gap-1 pl-2 text-xs text-mute">
          <ReactionButton small current={c.myReaction} onChange={react} />
          <button className="rounded-lg px-2 py-1 font-semibold hover:bg-line/60" onClick={() => setReplying((r) => !r)}>Reply</button>
          <time title={fullDate(c.createdAt)} dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
          {c.editedAt && <span>· edited</span>}
          <span className="ml-1"><ReactionSummary counts={c.reactionCounts} total={c.reactionTotal} onClick={() => setWho(true)} /></span>
        </div>

        {c.replyCount > 0 && replies === null && (
          <button className="mt-1 flex items-center gap-1.5 pl-2 text-xs font-semibold text-mute hover:underline" onClick={() => loadReplies(false)}>
            {loadingReplies ? <Spinner className="h-3 w-3" /> : <CornerDownRight className="h-3.5 w-3.5" />}View {plural(c.replyCount, 'reply', 'replies')}
          </button>
        )}
        {(replies?.length > 0 || replying) && (
          <ul className="mt-2 space-y-2">
            {replies?.map((r) => (
              <Comment key={r._id} c={r} depth={1} postId={postId} postOwnerId={postOwnerId}
                onChange={(n) => setReplies((list) => list.map((x) => (x._id === n._id ? n : x)))}
                onDelete={() => { setReplies((l) => l.filter((x) => x._id !== r._id)); onChange({ ...c, replyCount: Math.max(0, c.replyCount - 1) }); }} />
            ))}
            {cursor && <li><button className="pl-2 text-xs font-semibold text-mute hover:underline" onClick={() => loadReplies(true)}>View more replies</button></li>}
            {replying && <li><CommentForm autoFocus postId={postId} parentId={c.parent || c._id} replyTo={depth ? c.author.username : undefined} onCancel={() => setReplying(false)}
              onCreated={(res) => { setReplies((r) => [...(r || []), res.comment]); onChange({ ...c, replyCount: (c.replyCount || 0) + 1 }); setReplying(false); }} /></li>}
          </ul>
        )}
      </div>
      <ConfirmDialog open={confirm} danger title="Delete comment?" message="This also removes its replies." confirmLabel="Delete" onClose={() => setConfirm(false)} onConfirm={async () => { try { await commentApi.remove(c._id); onDelete(c); } catch (e) { toast(errorMessage(e), 'error'); } }} />
      {report && <ReportModal open onClose={() => setReport(false)} targetType="comment" target={c._id} />}
      {who && <ReactionsModal open onClose={() => setWho(false)} targetType="comment" target={c._id} />}
    </li>
  );
}

export default function CommentSection({ post, autoFocus }) {
  const dispatch = useDispatch();
  const toast = useToast();
  const [sort, setSort] = useState('top');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(post.commentCount);
  const [error, setError] = useState('');

  const load = async (more) => {
    setLoading(true); setError('');
    try {
      const res = await commentApi.list(post._id, { sort, limit: 10, cursor: more ? cursor : undefined });
      setItems((cur) => (more ? [...cur, ...res.items.filter((x) => !cur.some((y) => y._id === x._id))] : res.items));
      setCursor(res.nextCursor);
      if (res.total != null) setTotal(res.total);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, [post._id, sort]);

  // realtime: new top-level comments, edits, deletions and pins from other people
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const match = (p) => p.postId === post._id;
    const onNew = (p) => { if (match(p) && !p.comment.parent) setItems((cur) => (cur.some((x) => x._id === p.comment._id) ? cur : [...cur, p.comment])); };
    const onUpd = (p) => match(p) && setItems((cur) => cur.map((x) => (x._id === p.comment._id ? { ...x, ...p.comment } : x)));
    const onDel = (p) => match(p) && !p.parent && setItems((cur) => cur.filter((x) => x._id !== p.commentId));
    s.on('comment:new', onNew); s.on('comment:update', onUpd); s.on('comment:delete', onDel);
    return () => { s.off('comment:new', onNew); s.off('comment:update', onUpd); s.off('comment:delete', onDel); };
  }, [post._id]);

  const setCount = (n) => dispatch(patchPost({ id: post._id, changes: { commentCount: n } }));

  return (
    <section aria-label="Comments" className="space-y-3 border-t border-line px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{plural(post.commentCount, 'comment')}</h3>
        <select aria-label="Sort comments" className="rounded-lg bg-line/50 px-2 py-1 text-xs font-semibold outline-none" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="top">Top comments</option><option value="newest">Newest</option><option value="oldest">Oldest</option>
        </select>
      </div>
      {post.canComment !== false && (
        <CommentForm postId={post._id} autoFocus={autoFocus} onCreated={(res) => {
          // the socket event can reach us before the HTTP response does, so never add the same comment twice
          setItems((cur) => (cur.some((x) => x._id === res.comment._id) ? cur : sort === 'newest' ? [res.comment, ...cur] : [...cur, res.comment]));
          setCount(res.commentCount);
        }} />
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error} <button className="underline" onClick={() => load(false)}>Retry</button></p>}
      <ul className="space-y-3">
        {items.map((c) => (
          <Comment key={c._id} c={c} postId={post._id} postOwnerId={post.author._id}
            onChange={(n, reload) => { if (reload) load(false); else setItems((cur) => cur.map((x) => (x._id === n._id ? n : x))); }}
            onDelete={async () => { setItems((cur) => cur.filter((x) => x._id !== c._id)); try { setCount((await postApi.get(post._id)).commentCount); } catch { setCount(Math.max(0, post.commentCount - 1)); } }} />
        ))}
      </ul>
      {loading && <div className="flex justify-center py-2"><Spinner /></div>}
      {!loading && !items.length && !error && <p className="py-3 text-center text-sm text-mute">No comments yet. Start the conversation.</p>}
      {cursor && !loading && <button className="text-sm font-semibold text-mute hover:underline" onClick={() => load(true)}>View more comments{total ? ` (${items.length} of ${total})` : ''}</button>}
    </section>
  );
}
