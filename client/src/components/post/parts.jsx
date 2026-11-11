import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { ThumbsUp, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { REACTIONS, REACTION_META } from '@shared/constants.js';
import { tokenize, compact } from '../../lib/format.js';
import { postApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { patchPost } from '../../store/slices.js';
import { useToast } from '../../lib/hooks.js';

/** Renders text with linked #tags and @mentions. Never uses innerHTML. */
export function RichText({ text, className = '' }) {
  if (!text) return null;
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {tokenize(text).map((p, i) => {
        if (p.t === 'tag') return <Link key={i} to={`/hashtag/${p.v}`} className="font-medium text-brand-600 hover:underline">#{p.v}</Link>;
        if (p.t === 'mention') return <Link key={i} to={`/u/${p.v}`} className="font-medium text-brand-600 hover:underline">@{p.v}</Link>;
        if (p.t === 'url') return <a key={i} href={p.v} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-brand-600 hover:underline">{p.v}</a>;
        return <span key={i}>{p.v}</span>;
      })}
    </p>
  );
}

export function ReactionPicker({ onPick, onClose }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
      role="menu" aria-label="Choose a reaction" className="absolute bottom-full left-0 z-20 mb-2 flex gap-1 rounded-full border border-line bg-surface px-2 py-1.5 shadow-xl">
      {REACTIONS.map((r) => (
        <button key={r} role="menuitem" title={REACTION_META[r].label} aria-label={REACTION_META[r].label}
          onClick={() => { onPick(r); onClose(); }}
          className="rounded-full px-1 text-2xl transition-transform hover:-translate-y-1 hover:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
          {REACTION_META[r].emoji}
        </button>
      ))}
    </motion.div>
  );
}

/** Like button: click toggles Like, hover (or long press) opens the six-reaction picker. */
export function ReactionButton({ current, onChange, small }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const press = useRef(false);
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 350); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 250); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const meta = current ? REACTION_META[current] : null;
  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <AnimatePresence>{open && <ReactionPicker onPick={(r) => onChange(r)} onClose={() => setOpen(false)} />}</AnimatePresence>
      <button
        className={`btn-ghost ${small ? '!px-2 !py-1 text-xs' : ''}`}
        style={meta ? { color: meta.color } : undefined}
        aria-pressed={!!current}
        onTouchStart={() => { press.current = false; timer.current = setTimeout(() => { press.current = true; setOpen(true); }, 450); }}
        onTouchEnd={() => clearTimeout(timer.current)}
        onClick={() => { if (press.current) { press.current = false; return; } onChange(current ? null : 'like'); setOpen(false); }}
        onFocus={show}
      >
        {meta ? <span className="text-base leading-none">{meta.emoji}</span> : <ThumbsUp className="h-4 w-4" />}
        <span>{meta ? meta.label : 'Like'}</span>
      </button>
    </div>
  );
}

export function ReactionSummary({ counts = {}, total = 0, onClick }) {
  if (!total) return null;
  const top = REACTIONS.filter((r) => counts[r] > 0).sort((a, b) => counts[b] - counts[a]).slice(0, 3);
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-sm text-mute hover:underline" aria-label={`${total} reactions`}>
      <span className="flex -space-x-1">
        {top.map((r) => <span key={r} className="rounded-full bg-surface text-sm ring-2 ring-surface">{REACTION_META[r].emoji}</span>)}
      </span>
      {compact(total)}
    </button>
  );
}

export function MediaGrid({ media = [] }) {
  const [at, setAt] = useState(null);
  const shown = media.slice(0, 4);
  const extra = media.length - 4;
  useEffect(() => {
    if (at === null) return undefined;
    const k = (e) => {
      if (e.key === 'Escape') setAt(null);
      if (e.key === 'ArrowRight') setAt((i) => Math.min(media.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [at, media.length]);
  if (!media.length) return null;
  const cols = shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <>
      <div className={`grid gap-0.5 overflow-hidden rounded-xl ${cols}`}>
        {shown.map((m, i) => (
          <button key={m.url} onClick={() => setAt(i)} aria-label={`Open photo ${i + 1}`} className={`relative bg-line ${shown.length === 1 ? 'max-h-[28rem]' : 'aspect-square'} ${shown.length === 3 && i === 0 ? 'row-span-2 !aspect-auto' : ''}`}>
            <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            {i === 3 && extra > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white">+{extra}</span>}
          </button>
        ))}
      </div>
      <AnimatePresence>
        {at !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setAt(null)} role="dialog" aria-modal="true" aria-label="Photo viewer">
            <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Close" onClick={() => setAt(null)}><X /></button>
            {at > 0 && <button className="absolute left-3 rounded-full bg-white/10 p-2 text-white" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setAt(at - 1); }}><ChevronLeft /></button>}
            <img src={media[at].url} alt="" className="max-h-[90vh] max-w-[92vw] object-contain" onClick={(e) => e.stopPropagation()} />
            {at < media.length - 1 && <button className="absolute right-3 rounded-full bg-white/10 p-2 text-white" aria-label="Next" onClick={(e) => { e.stopPropagation(); setAt(at + 1); }}><ChevronRight /></button>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function PollView({ post }) {
  const poll = post.poll;
  const dispatch = useDispatch();
  const toast = useToast();
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const voted = (poll.myVote || []).length > 0;
  const showResults = voted || poll.ended;
  const total = poll.totalVotes || 0;

  const submit = async (ids) => {
    setBusy(true);
    try {
      const fresh = await postApi.vote(post._id, ids);
      dispatch(patchPost({ id: post._id, changes: { poll: fresh.poll || { ...poll, ...fresh, myVote: ids } } }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id) => {
    if (poll.multiple) setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    else submit([id]);
  };

  return (
    <div className="space-y-2 rounded-xl border border-line p-3.5" role="group" aria-label={`Poll: ${poll.question}`}>
      <p className="font-semibold">{poll.question}</p>
      {poll.options.map((o) => {
        const pct = total ? Math.round((o.count / total) * 100) : 0;
        const mine = (poll.myVote || []).includes(o._id);
        return showResults ? (
          <div key={o._id} className="relative overflow-hidden rounded-lg border border-line px-3 py-2 text-sm">
            <motion.div className={`absolute inset-y-0 left-0 ${mine ? 'bg-brand-500/25' : 'bg-line/70'}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
            <div className="relative flex justify-between gap-3"><span className={mine ? 'font-semibold' : ''}>{o.text}{mine && ' ✓'}</span><span className="tabular-nums text-mute">{pct}%</span></div>
          </div>
        ) : (
          <button key={o._id} disabled={busy} onClick={() => toggle(o._id)} aria-pressed={picked.includes(o._id)}
            className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:border-brand-500 ${picked.includes(o._id) ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-line'}`}>
            {o.text}
          </button>
        );
      })}
      {!showResults && poll.multiple && <button className="btn-primary !py-1.5" disabled={!picked.length || busy} onClick={() => submit(picked)}>Vote</button>}
      <p className="text-xs text-mute">{total} {total === 1 ? 'vote' : 'votes'}{poll.multiple && !showResults ? ' · choose any' : ''}{poll.ended ? ' · final results' : ''}</p>
    </div>
  );
}
