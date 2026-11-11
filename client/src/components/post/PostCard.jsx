import { memo, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { MessageCircle, Share2, Bookmark, BookmarkCheck, Pin, PinOff, Pencil, Trash2, EyeOff, BellOff, Flag, Link2, MoreHorizontal } from 'lucide-react';
import { AUDIENCE_LABELS } from '@shared/constants.js';
import { postApi, reactionApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { watchPost } from '../../lib/socket.js';
import { timeAgo, fullDate, plural } from '../../lib/format.js';
import { Avatar, Verified, Menu, ConfirmDialog } from '../ui/index.jsx';
import { AUDIENCE_ICON } from './AudienceSelect.jsx';
import { RichText, MediaGrid, PollView, ReactionButton, ReactionSummary } from './parts.jsx';
import { ReportModal, ReactionsModal, ShareModal, EditPostModal } from './Modals.jsx';
import CommentSection from './CommentSection.jsx';
import { FEELINGS } from '@shared/constants.js';
import { postSelectors, applyReaction, patchPost, removePost, upsertPost } from '../../store/slices.js';
import { useCurrentUser, useToast } from '../../lib/hooks.js';
import { adminApi } from '../../api/index.js';

function SharedPost({ post }) {
  if (post.unavailable) return <div className="rounded-xl border border-line p-3 text-sm text-mute">This content isn't available.</div>;
  return (
    <Link to={`/post/${post._id}`} className="block space-y-2 rounded-xl border border-line p-3 hover:bg-line/30">
      <div className="flex items-center gap-2"><Avatar user={post.author} size={28} /><span className="text-sm font-semibold">{post.author.name}</span><span className="text-xs text-mute">{timeAgo(post.createdAt)}</span></div>
      <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm">{post.text}</p>
      {post.media?.[0] && <img src={post.media[0].url} alt="" loading="lazy" className="max-h-64 w-full rounded-lg object-cover" />}
    </Link>
  );
}

function PostCard({ id, expanded = false, onRemoved }) {
  const post = useSelector((s) => postSelectors.selectById(s, id));
  const me = useCurrentUser();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const ref = useRef(null);
  const [showComments, setShowComments] = useState(expanded);
  const [modal, setModal] = useState(null); // report | share | edit | delete | reactions
  const [commentFocus, setCommentFocus] = useState(false);

  // Join the post's live room only while the card is on (or near) the screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let leave = null;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !leave) leave = watchPost(id);
      else if (!e.isIntersecting && leave) { leave(); leave = null; }
    }, { rootMargin: '300px' });
    obs.observe(el);
    return () => { obs.disconnect(); leave?.(); };
  }, [id]);

  if (!post) return null;
  const mine = post.author._id === me?._id;
  const staff = ['admin', 'moderator'].includes(me?.role);
  const AudIcon = AUDIENCE_ICON[post.audience];
  const feeling = post.feeling && FEELINGS.find((f) => f.label === post.feeling);
  const fail = (e) => toast(errorMessage(e), 'error');

  const react = async (type) => {
    const before = { myReaction: post.myReaction, reactionCounts: post.reactionCounts, reactionTotal: post.reactionTotal };
    dispatch(applyReaction({ id, type }));
    try {
      const res = type ? await reactionApi.set('post', id, type) : await reactionApi.remove('post', id);
      dispatch(patchPost({ id, changes: { myReaction: res.myReaction, reactionCounts: res.reactionCounts, reactionTotal: res.reactionTotal } }));
    } catch (e) { dispatch(patchPost({ id, changes: before })); fail(e); }
  };

  const toggleSave = async () => {
    try {
      post.saved ? await postApi.unsave(id) : await postApi.save(id);
      dispatch(patchPost({ id, changes: { saved: !post.saved } }));
      toast(post.saved ? 'Removed from saved' : 'Saved to your collection', 'success');
    } catch (e) { fail(e); }
  };
  const togglePin = async () => {
    try { await postApi.pin(id, !post.pinned); dispatch(patchPost({ id, changes: { pinned: !post.pinned } })); toast(post.pinned ? 'Unpinned' : 'Pinned to your profile', 'success'); } catch (e) { fail(e); }
  };
  const hide = async () => { try { await postApi.hide(id); dispatch(removePost(id)); toast('Post hidden. You will see fewer like it.', 'success'); onRemoved?.(id); } catch (e) { fail(e); } };
  const snooze = async () => { try { await postApi.snooze(id, 30); toast(`Snoozed ${post.author.name} for 30 days`, 'success'); dispatch(removePost(id)); } catch (e) { fail(e); } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/post/${id}`); toast('Link copied', 'success'); } catch { toast('Could not copy the link', 'error'); }
  };
  const remove = async () => {
    try {
      if (mine) await postApi.remove(id); else await adminApi.deletePost(id);
      dispatch(removePost(id)); toast('Post deleted', 'success'); onRemoved?.(id);
      if (expanded) navigate('/');
    } catch (e) { fail(e); throw e; }
  };

  return (
    <article ref={ref} className="card" aria-label={`Post by ${post.author.name}`}>
      {post.pinned && <p className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-mute"><Pin className="h-3.5 w-3.5" />Pinned post</p>}
      <header className="flex items-start gap-3 px-4 pt-4">
        <Link to={`/u/${post.author.username}`}><Avatar user={post.author} size={42} /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">
            <Link to={`/u/${post.author.username}`} className="font-semibold hover:underline">{post.author.name}</Link> <Verified user={post.author} />
            {feeling && <span className="text-mute"> is feeling {feeling.emoji} {feeling.label}</span>}
            {post.tags?.length > 0 && <span className="text-mute"> with {post.tags.map((t, i) => <span key={t._id}>{i ? ', ' : ''}<Link className="font-semibold text-ink hover:underline" to={`/u/${t.username}`}>{t.name}</Link></span>)}</span>}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-mute">
            <Link to={`/post/${id}`} title={fullDate(post.createdAt)} className="hover:underline"><time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time></Link>
            {post.editedAt && <span>· edited</span>}
            <span aria-label={`Audience: ${AUDIENCE_LABELS[post.audience]}`} title={AUDIENCE_LABELS[post.audience]} className="inline-flex">· {AudIcon && <AudIcon className="h-3.5 w-3.5" />}</span>
            {post.location && <span>· 📍 {post.location}</span>}
          </p>
        </div>
        <Menu label="Post options" trigger={<MoreHorizontal className="h-5 w-5" />} items={[
          { label: post.saved ? 'Unsave post' : 'Save post', icon: post.saved ? BookmarkCheck : Bookmark, onClick: toggleSave },
          { label: 'Copy link', icon: Link2, onClick: copy },
          { label: post.pinned ? 'Unpin from profile' : 'Pin to profile', icon: post.pinned ? PinOff : Pin, onClick: togglePin, hidden: !mine },
          { label: 'Edit post', icon: Pencil, onClick: () => setModal('edit'), hidden: !mine },
          { label: 'Hide post', icon: EyeOff, onClick: hide, hidden: mine },
          { label: `Snooze ${post.author.name.split(' ')[0]} for 30 days`, icon: BellOff, onClick: snooze, hidden: mine },
          { label: 'Report post', icon: Flag, onClick: () => setModal('report'), hidden: mine },
          { label: mine ? 'Delete post' : 'Remove (moderator)', icon: Trash2, danger: true, onClick: () => setModal('delete'), hidden: !mine && !staff },
        ]} />
      </header>

      <div className="space-y-3 px-4 py-3">
        <RichText text={post.type === 'poll' ? '' : post.text} className="text-[15px] leading-relaxed" />
        {post.media?.length > 0 && <MediaGrid media={post.media} />}
        {post.poll && <PollView post={post} />}
        {post.sharedPost && <SharedPost post={post.sharedPost} />}
      </div>

      <div className="flex items-center justify-between px-4 pb-2">
        <ReactionSummary counts={post.reactionCounts} total={post.reactionTotal} onClick={() => setModal('reactions')} />
        <div className="flex gap-3 text-sm text-mute">
          <button className="hover:underline" onClick={() => setShowComments((s) => !s)}>{plural(post.commentCount, 'comment')}</button>
          {post.shareCount > 0 && <span>{plural(post.shareCount, 'share')}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 border-t border-line px-2 py-1 text-sm">
        <div className="flex justify-center"><ReactionButton current={post.myReaction} onChange={react} /></div>
        <button className="btn-ghost" onClick={() => { setShowComments(true); setCommentFocus(true); }}><MessageCircle className="h-4 w-4" />Comment</button>
        <button className="btn-ghost" disabled={post.audience === 'only_me'} title={post.audience === 'only_me' ? 'Only-me posts cannot be shared' : undefined} onClick={() => setModal('share')}><Share2 className="h-4 w-4" />Share</button>
      </div>

      {showComments && <CommentSection post={post} autoFocus={commentFocus} />}

      {modal === 'report' && <ReportModal open onClose={() => setModal(null)} targetType="post" target={id} />}
      {modal === 'reactions' && <ReactionsModal open onClose={() => setModal(null)} targetType="post" target={id} />}
      {modal === 'share' && <ShareModal open onClose={() => setModal(null)} post={post} defaultAudience={post.audience} />}
      {modal === 'edit' && <EditPostModal open onClose={() => setModal(null)} post={post} onSaved={(p) => dispatch(upsertPost(p))} />}
      <ConfirmDialog open={modal === 'delete'} danger title="Delete this post?" message="Its comments and reactions will be removed too. This can't be undone." confirmLabel="Delete" onClose={() => setModal(null)} onConfirm={remove} />
    </article>
  );
}

export default memo(PostCard);
