import { useState } from 'react';
import { Link } from 'react-router-dom';
import { REPORT_CATEGORIES, REACTIONS, REACTION_META, LIMITS } from '@shared/constants.js';
import { reportApi, reactionApi, postApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { Modal, Avatar, Spinner } from '../ui/index.jsx';
import Sentinel from '../ui/Sentinel.jsx';
import AudienceSelect from './AudienceSelect.jsx';
import { useInfinite, useToast } from '../../lib/hooks.js';

const label = (c) => c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

export function ReportModal({ open, onClose, targetType, target }) {
  const toast = useToast();
  const [category, setCategory] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await reportApi.create({ targetType, target, category, details });
      toast('Thanks — our moderators will take a look.', 'success');
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Report ${targetType}`} footer={<>
      <button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn-danger" disabled={busy} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}Submit report</button></>}>
      <fieldset className="space-y-1">
        <legend className="label">What is wrong?</legend>
        {REPORT_CATEGORIES.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-line/50">
            <input type="radio" name="cat" className="accent-indigo-600" checked={category === c} onChange={() => setCategory(c)} />{label(c)}
          </label>
        ))}
      </fieldset>
      <label className="label mt-3" htmlFor="rd">Details (optional)</label>
      <textarea id="rd" className="input" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
    </Modal>
  );
}

export function ReactionsModal({ open, onClose, targetType, target }) {
  const [type, setType] = useState('');
  const list = useInfinite((cursor) => reactionApi.list({ targetType, target, type, cursor, limit: 20 }), [target, type, open]);
  return (
    <Modal open={open} onClose={onClose} title="Reactions">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button className={type === '' ? 'btn-soft !py-1' : 'btn-ghost !py-1'} onClick={() => setType('')}>All</button>
        {REACTIONS.map((r) => <button key={r} className={type === r ? 'btn-soft !py-1' : 'btn-ghost !py-1'} onClick={() => setType(r)} aria-label={REACTION_META[r].label}>{REACTION_META[r].emoji}</button>)}
      </div>
      <ul className="space-y-1">
        {list.items.map((r, i) => (
          <li key={`${r.user._id}${i}`}>
            <Link to={`/u/${r.user.username}`} onClick={onClose} className="flex items-center gap-3 rounded-lg p-2 hover:bg-line/50">
              <span className="relative"><Avatar user={r.user} size={36} /><span className="absolute -bottom-1 -right-1 text-sm">{REACTION_META[r.type]?.emoji}</span></span>
              <span className="text-sm font-medium">{r.user.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {list.empty && <p className="py-6 text-center text-sm text-mute">No reactions yet.</p>}
      {list.loading && !list.items.length && <div className="flex justify-center py-6"><Spinner /></div>}
      <Sentinel loading={list.loading} done={list.done} error={list.error} onMore={list.loadMore} />
    </Modal>
  );
}

export function ShareModal({ open, onClose, post, defaultAudience }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [aud, setAud] = useState({ audience: defaultAudience === 'only_me' ? 'friends' : defaultAudience || 'friends', audienceList: [] });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await postApi.share(post._id, { text, audience: aud.audience, ...(aud.audienceList.length ? { audienceList: aud.audienceList } : {}) });
      toast('Shared to your timeline', 'success');
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Share post" footer={<>
      <AudienceSelect value={aud} onChange={setAud} compact />
      <button className="btn-primary" disabled={busy} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}Share now</button></>}>
      <textarea className="input" rows={3} maxLength={LIMITS.postText} placeholder="Say something about this…" aria-label="Your comment" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="mt-3 line-clamp-3 rounded-lg bg-line/40 p-3 text-sm text-mute"><b className="text-ink">{post.author.name}</b> · {post.text || 'Shared a photo'}</p>
    </Modal>
  );
}

export function EditPostModal({ open, onClose, post, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState(post.text);
  const [aud, setAud] = useState({ audience: post.audience, audienceList: [] });
  const [busy, setBusy] = useState(false);
  const needsList = ['specific', 'friends_except'].includes(aud.audience);
  const submit = async () => {
    setBusy(true);
    try {
      const body = { text };
      if (aud.audience !== post.audience || aud.audienceList.length) { body.audience = aud.audience; if (needsList) body.audienceList = aud.audienceList; }
      onSaved(await postApi.edit(post._id, body));
      toast('Post updated', 'success');
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit post" footer={<>
      <AudienceSelect value={aud} onChange={setAud} />
      <button className="btn-primary" disabled={busy || (!text.trim() && !post.media?.length && post.type !== 'poll')} onClick={submit}>{busy && <Spinner className="h-4 w-4" />}Save</button></>}>
      <textarea className="input" rows={5} maxLength={LIMITS.postText} aria-label="Post text" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
