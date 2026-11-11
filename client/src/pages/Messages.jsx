import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Send, Trash2, CheckCheck, ImagePlus, Smile, X } from 'lucide-react';
import { LIMITS } from '@shared/constants.js';
import { messageApi } from '../api/index.js';
import { errorMessage } from '../api/http.js';
import { Avatar, PresenceAvatar, Verified, Spinner, Skeleton, Empty, ErrorState } from '../components/ui/index.jsx';
import { useCurrentUser, useTitle, useToast } from '../lib/hooks.js';
import { timeAgo, fullDate } from '../lib/format.js';
import { getSocket } from '../lib/socket.js';

const EMOJIS = ['😀', '😂', '🥹', '😍', '🥰', '😎', '🤔', '😅', '😭', '😡', '👍', '👎', '🙏', '👏', '🙌', '💪', '🔥', '✨', '🎉', '❤️', '💔', '💯', '👀', '🤝', '☕', '🍕', '🎶', '🌟', '😴', '🤯'];
const MAX_PHOTO = 4 * 1024 * 1024; // matches LIMITS.uploadBytes

/** Subscribes to chat events the Realtime component forwards from the socket. */
function useChatEvents(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e) => ref.current(e.detail.event, e.detail.payload);
    window.addEventListener('circle:chat', fn);
    return () => window.removeEventListener('circle:chat', fn);
  }, []);
}

function ConversationList({ items, activeId, loading, error, onRetry }) {
  if (error) return <div className="p-4"><ErrorState message={error} onRetry={onRetry} /></div>;
  if (loading) return <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!items.length) return <div className="p-4"><Empty icon={MessageCircle} title="No conversations yet" hint="Open someone's profile and press Message to start one." /></div>;
  return (
    <ul>
      {items.map((c) => (
        <li key={c._id}>
          <Link to={`/messages/${c._id}`} aria-current={activeId === c._id ? 'page' : undefined}
            className={`flex items-center gap-3 px-4 py-3 transition hover:bg-line/40 ${activeId === c._id ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}>
            <PresenceAvatar user={c.other} online={c.other.online} size={44} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{c.other.name}</span>
                {c.lastMessage && <span className="shrink-0 text-xs text-mute">{timeAgo(c.lastMessage.at)}</span>}
              </span>
              <span className={`block truncate text-sm ${c.unread ? 'font-semibold text-ink' : 'text-mute'}`}>
                {c.lastMessage ? `${c.lastMessage.sender === c.other._id ? '' : 'You: '}${c.lastMessage.text}` : 'Say hello'}
              </span>
            </span>
            {c.unread > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Bubble({ m, mine, showSeen, onDelete }) {
  if (m.deleted) {
    return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><span className="rounded-2xl border border-dashed border-line px-3 py-1.5 text-xs italic text-mute">Message removed</span></div>;
  }
  return (
    <div className={`group flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] ${mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-line/60'}`} title={fullDate(m.createdAt)}>
        {m.image && <a href={m.image} target="_blank" rel="noopener noreferrer"><img src={m.image} alt="Shared photo" loading="lazy" className="mb-1 max-h-72 w-full rounded-xl object-cover" /></a>}
        {m.text}
        {showSeen && <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] opacity-80"><CheckCheck className="h-3 w-3" />Seen</span>}
      </div>
      {mine && <button className="rounded-full p-1.5 text-mute opacity-0 transition hover:bg-line hover:text-red-600 focus:opacity-100 group-hover:opacity-100" aria-label="Unsend message" onClick={() => onDelete(m)}><Trash2 className="h-4 w-4" /></button>}
    </div>
  );
}

function Thread({ id, onActivity }) {
  const me = useCurrentUser();
  const toast = useToast();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]); // oldest first
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const typingTimer = useRef(null);
  const lastSent = useRef(0);
  const fileInput = useRef(null);
  const bottom = useRef(null);
  const stick = useRef(true);
  useTitle(conv?.other?.name ? `Chat with ${conv.other.name}` : 'Messages');

  const markRead = useCallback(() => messageApi.read(id).then(onActivity).catch(() => {}), [id, onActivity]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, page] = await Promise.all([messageApi.conversation(id), messageApi.messages(id, { limit: 30 })]);
      setConv(c); setMessages([...page.items].reverse()); setCursor(page.nextCursor);
      stick.current = true;
      if (c.unread) markRead();
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [id, markRead]);
  useEffect(() => { load(); }, [load]);

  const loadEarlier = async () => {
    try {
      const page = await messageApi.messages(id, { limit: 30, cursor });
      stick.current = false;
      setMessages((prev) => [...[...page.items].reverse(), ...prev]); setCursor(page.nextCursor);
    } catch (e) { toast(errorMessage(e), 'error'); }
  };

  useChatEvents((event, p) => {
    if (event === 'presence') {
      setConv((c) => (c && c.other._id === p.userId ? { ...c, other: { ...c.other, online: p.online } } : c));
      return;
    }
    if (p.conversationId !== id) return;
    if (event === 'typing') {
      clearTimeout(typingTimer.current);
      setTyping(p.typing);
      if (p.typing) typingTimer.current = setTimeout(() => setTyping(false), 4000);
      return;
    }
    if (event === 'new') {
      stick.current = true;
      setTyping(false);
      setMessages((prev) => (prev.some((m) => m._id === p.message._id) ? prev : [...prev, p.message]));
      if (p.from !== me._id) markRead();
    } else if (event === 'read') {
      setMessages((prev) => prev.map((m) => (m.sender === me._id && !m.readAt ? { ...m, readAt: p.at } : m)));
    } else if (event === 'delete') {
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, deleted: true, text: '' } : m)));
    }
  });

  useLayoutEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  useEffect(() => () => clearTimeout(typingTimer.current), []);
  useEffect(() => {
    if (!photo) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const emitTyping = (on) => {
    const now = Date.now();
    if (on && now - lastSent.current < 2000) return;
    lastSent.current = on ? now : 0;
    getSocket()?.emit('typing', { conversationId: id, typing: on });
  };
  const onDraft = (value) => { setDraft(value); emitTyping(!!value); };
  const pickPhoto = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) return toast('Use a JPG, PNG, GIF or WEBP image', 'error');
    if (f.size > MAX_PHOTO) return toast('Photos can be up to 4 MB', 'error');
    setPhoto(f);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && !photo) || sending) return;
    setSending(true);
    try {
      const msg = await messageApi.send(id, text, photo);
      stick.current = true;
      setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
      setDraft(''); setPhoto(null); setEmojiOpen(false); emitTyping(false);
      onActivity();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setSending(false); }
  };
  const remove = async (m) => {
    try { await messageApi.remove(m._id); setMessages((prev) => prev.map((x) => (x._id === m._id ? { ...x, deleted: true, text: '' } : x))); onActivity(); }
    catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (error) return <div className="p-6"><ErrorState message={error} onRetry={load} /></div>;
  if (loading || !conv) return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6" /></div>;

  const lastMine = [...messages].reverse().find((m) => m.sender === me._id && !m.deleted);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        <Link to="/messages" className="btn-ghost !p-2 md:hidden" aria-label="Back to conversations"><ArrowLeft className="h-5 w-5" /></Link>
        <Link to={`/u/${conv.other.username}`} className="flex min-w-0 items-center gap-3 hover:opacity-80">
          <PresenceAvatar user={conv.other} online={conv.other.online} size={36} />
          <span className="min-w-0"><span className="block truncate text-sm font-bold">{conv.other.name} <Verified user={conv.other} /></span><span className="block truncate text-xs text-mute">{typing ? <span className="font-medium text-brand-600">typing…</span> : conv.other.online ? 'Online' : `@${conv.other.username}`}</span></span>
        </Link>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4" role="log" aria-live="polite" aria-label="Messages">
        {cursor && <div className="text-center"><button className="btn-ghost text-xs" onClick={loadEarlier}>Load earlier messages</button></div>}
        {!messages.length && <p className="py-10 text-center text-sm text-mute">No messages yet. Say hello to {conv.other.name.split(' ')[0]}!</p>}
        {messages.map((m) => <Bubble key={m._id} m={m} mine={m.sender === me._id} showSeen={lastMine?._id === m._id && !!m.readAt} onDelete={remove} />)}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="relative border-t border-line p-3">
        {typing && <p className="absolute -top-6 left-4 text-xs text-mute" aria-live="polite">{conv.other.name.split(' ')[0]} is typing…</p>}
        {preview && (
          <div className="mb-2 flex items-start gap-2">
            <img src={preview} alt="Photo to send" className="h-20 w-20 rounded-xl object-cover" />
            <button type="button" className="btn-ghost !p-1.5" aria-label="Remove photo" onClick={() => setPhoto(null)}><X className="h-4 w-4" /></button>
          </div>
        )}
        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-2 grid w-64 grid-cols-6 gap-1 rounded-2xl border border-line bg-surface p-2 shadow-lg" role="listbox" aria-label="Emoji">
            {EMOJIS.map((em) => <button type="button" key={em} className="rounded-lg p-1.5 text-xl transition hover:bg-line" onClick={() => setDraft((d) => d + em)} aria-label={`Insert ${em}`}>{em}</button>)}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={pickPhoto} aria-label="Choose photo" />
          <button type="button" className="btn-ghost !p-2.5" aria-label="Attach photo" onClick={() => fileInput.current?.click()}><ImagePlus className="h-5 w-5" /></button>
          <button type="button" className="btn-ghost !p-2.5" aria-label="Add emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}><Smile className="h-5 w-5" /></button>
          <textarea className="input max-h-32 min-h-[2.75rem] flex-1 resize-none" rows={1} maxLength={LIMITS.messageText} placeholder="Write a message…" aria-label="Message"
            value={draft} onChange={(e) => onDraft(e.target.value)} onBlur={() => emitTyping(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }} />
          <button className="btn-primary !px-3.5" disabled={(!draft.trim() && !photo) || sending} aria-label="Send message">{sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}</button>
        </div>
      </form>
    </div>
  );
}

export default function Messages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useTitle('Messages');

  const refresh = useCallback(() => messageApi.conversations().then((r) => { setItems(r.items); setError(''); }).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false)), []);
  useEffect(() => { refresh(); }, [refresh]);
  useChatEvents((event, p) => {
    if (event === 'presence') setItems((prev) => prev.map((c) => (c.other._id === p.userId ? { ...c, other: { ...c.other, online: p.online } } : c)));
    else if (event === 'new' || event === 'delete') refresh();
  });
  useEffect(() => { if (!id && items.length && window.matchMedia('(min-width: 768px)').matches) navigate(`/messages/${items[0]._id}`, { replace: true }); }, [id, items, navigate]);

  return (
    <div className="card grid h-[calc(100vh-7.5rem)] min-h-[28rem] overflow-hidden md:grid-cols-[19rem_1fr]">
      <aside className={`min-h-0 overflow-y-auto border-line md:border-r ${id ? 'hidden md:block' : ''}`} aria-label="Conversations">
        <h1 className="px-4 pb-1 pt-4 text-xl font-extrabold">Messages</h1>
        <ConversationList items={items} activeId={id} loading={loading} error={error} onRetry={refresh} />
      </aside>
      <section className={`min-h-0 ${id ? '' : 'hidden md:block'}`} aria-label="Conversation">
        {id ? <Thread key={id} id={id} onActivity={refresh} /> : <div className="flex h-full items-center justify-center p-6"><Empty icon={MessageCircle} title="Select a conversation" hint="Pick a chat on the left, or press Message on someone's profile." /></div>}
      </section>
    </div>
  );
}
