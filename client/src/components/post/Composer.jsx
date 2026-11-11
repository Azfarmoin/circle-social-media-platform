import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { Image as ImageIcon, BarChart3, Smile, X, Plus, Trash2 } from 'lucide-react';
import { FEELINGS, LIMITS } from '@shared/constants.js';
import { postApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { Avatar, Spinner } from '../ui/index.jsx';
import AudienceSelect from './AudienceSelect.jsx';
import { useCurrentUser, useToast } from '../../lib/hooks.js';
import { upsertPost } from '../../store/slices.js';

const MAX_BYTES = LIMITS.uploadBytes;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default function Composer({ onPosted, defaultAudience = 'friends' }) {
  const me = useCurrentUser();
  const dispatch = useDispatch();
  const toast = useToast();
  const [text, setText] = useState('');
  const [aud, setAud] = useState({ audience: defaultAudience, audienceList: [] });
  const [files, setFiles] = useState([]);
  const [poll, setPoll] = useState(null);
  const [feeling, setFeeling] = useState(null);
  const [feelOpen, setFeelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [focus, setFocus] = useState(false);
  const fileRef = useRef(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);
  useEffect(() => setAud((a) => (a.audience === defaultAudience || a.audienceList.length ? a : { audience: defaultAudience, audienceList: [] })), [defaultAudience]);

  const addFiles = (list) => {
    const next = [...files];
    for (const f of list) {
      if (!OK_TYPES.includes(f.type)) { toast(`${f.name} is not a supported image (JPEG, PNG, WebP or GIF).`, 'error'); continue; }
      if (f.size > MAX_BYTES) { toast(`${f.name} is larger than 4 MB.`, 'error'); continue; }
      if (next.length >= LIMITS.maxMedia) { toast(`You can attach up to ${LIMITS.maxMedia} photos.`, 'error'); break; }
      next.push(f);
    }
    setFiles(next);
  };

  const pollOk = !poll || (poll.question.trim() && poll.options.filter((o) => o.trim()).length >= 2);
  const hasContent = text.trim() || files.length || poll;
  const needsList = ['friends_except', 'specific'].includes(aud.audience);
  const canPost = hasContent && pollOk && !busy && !(aud.audience === 'specific' && !aud.audienceList.length);

  const reset = () => { setText(''); setFiles([]); setPoll(null); setFeeling(null); setFocus(false); setAud({ audience: defaultAudience, audienceList: [] }); };

  const submit = async (e) => {
    e?.preventDefault();
    if (!canPost) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('text', text);
      form.append('audience', aud.audience);
      if (needsList) form.append('audienceList', JSON.stringify(aud.audienceList));
      if (feeling) form.append('feeling', feeling.label);
      if (poll) form.append('poll', JSON.stringify({ question: poll.question, options: poll.options.filter((o) => o.trim()), multiple: poll.multiple, durationHours: poll.hours }));
      files.forEach((f) => form.append('images', f));
      const post = await postApi.create(form);
      dispatch(upsertPost(post));
      onPosted?.(post);
      reset();
      toast('Posted', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={`card p-4 transition ${drag ? 'ring-2 ring-brand-500' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]); }}>
      <div className="flex gap-3">
        <Avatar user={me} size={42} />
        <div className="min-w-0 flex-1">
          <textarea aria-label="What's on your mind?" value={text} maxLength={LIMITS.postText} rows={focus || text ? 3 : 1}
            onFocus={() => setFocus(true)} onChange={(e) => setText(e.target.value)} placeholder={`What's on your mind, ${me?.name?.split(' ')[0] || 'friend'}?`}
            className="w-full resize-none rounded-xl bg-line/40 px-4 py-2.5 text-[15px] outline-none placeholder:text-mute focus:bg-line/60" />
          {feeling && (
            <p className="mt-2 text-sm text-mute">Feeling {feeling.emoji} {feeling.label}
              <button type="button" aria-label="Remove feeling" className="ml-2 align-middle text-mute hover:text-ink" onClick={() => setFeeling(null)}><X className="inline h-3.5 w-3.5" /></button></p>
          )}
        </div>
      </div>

      {previews.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {previews.map((src, i) => (
            <div key={src} className="group relative aspect-square overflow-hidden rounded-lg bg-line">
              <img src={src} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {poll && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-2 overflow-hidden rounded-xl border border-line p-3">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">Poll</span>
              <button type="button" className="text-mute hover:text-red-500" aria-label="Remove poll" onClick={() => setPoll(null)}><Trash2 className="h-4 w-4" /></button></div>
            <input className="input" aria-label="Poll question" placeholder="Ask a question" maxLength={LIMITS.pollQuestion} value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} />
            {poll.options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} maxLength={LIMITS.pollOptionText} value={o}
                  onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                {poll.options.length > LIMITS.minPollOptions && <button type="button" className="btn-ghost !p-2" aria-label={`Remove option ${i + 1}`} onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {poll.options.length < LIMITS.maxPollOptions && <button type="button" className="btn-soft !py-1.5" onClick={() => setPoll({ ...poll, options: [...poll.options, ''] })}><Plus className="h-4 w-4" />Add option</button>}
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" checked={poll.multiple} onChange={(e) => setPoll({ ...poll, multiple: e.target.checked })} />Allow multiple answers</label>
              <label className="flex items-center gap-2">Ends in
                <select className="input !w-auto !py-1" value={poll.hours} onChange={(e) => setPoll({ ...poll, hours: Number(e.target.value) })}>
                  <option value={24}>1 day</option><option value={72}>3 days</option><option value={168}>1 week</option><option value={720}>30 days</option>
                </select></label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {feelOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 flex flex-wrap gap-1.5">
            {FEELINGS.map((f) => (
              <button type="button" key={f.label} onClick={() => { setFeeling(f); setFeelOpen(false); }} className="rounded-full border border-line px-3 py-1 text-sm hover:border-brand-500">{f.emoji} {f.label}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
        <input ref={fileRef} hidden type="file" accept={OK_TYPES.join(',')} multiple onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
        <button type="button" className="btn-ghost !px-2.5" onClick={() => fileRef.current?.click()} disabled={!!poll}><ImageIcon className="h-5 w-5 text-emerald-500" /><span className="hidden sm:inline">Photo</span></button>
        <button type="button" className="btn-ghost !px-2.5" onClick={() => setPoll(poll ? null : { question: '', options: ['', ''], multiple: false, hours: 72 })} disabled={files.length > 0}><BarChart3 className="h-5 w-5 text-amber-500" /><span className="hidden sm:inline">Poll</span></button>
        <button type="button" className="btn-ghost !px-2.5" onClick={() => setFeelOpen((o) => !o)} aria-expanded={feelOpen}><Smile className="h-5 w-5 text-sky-500" /><span className="hidden sm:inline">Feeling</span></button>
        <div className="ml-auto flex items-center gap-2">
          <AudienceSelect value={aud} onChange={setAud} />
          <button className="btn-primary" disabled={!canPost}>{busy ? <Spinner className="h-4 w-4" /> : 'Post'}</button>
        </div>
      </div>
    </form>
  );
}
