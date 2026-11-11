import { useEffect, useRef, useState, useCallback, useId, Children, isValidElement, cloneElement } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, Loader2, X, AlertCircle, CheckCircle2, Info, Inbox } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { dismissToast } from '../../store/slices.js';
import { initials } from '../../lib/format.js';

export const Spinner = ({ className = 'h-5 w-5' }) => <Loader2 className={`animate-spin ${className}`} aria-label="Loading" />;

const COLORS = ['bg-indigo-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-500', 'bg-fuchsia-500', 'bg-teal-500'];
const colorFor = (s = '') => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

export function Avatar({ user, size = 40, className = '' }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, size / 2.6) };
  if (user?.avatar && !failed) {
    return <img src={user.avatar} alt="" loading="lazy" onError={() => setFailed(true)} style={style} className={`shrink-0 rounded-full bg-line object-cover ${className}`} />;
  }
  return (
    <span style={style} aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${colorFor(user?.username)} ${className}`}>
      {initials(user?.name || user?.username)}
    </span>
  );
}

/** An avatar with a small green dot when the person is online. */
export function PresenceAvatar({ user, online, size = 40 }) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar user={user} size={size} />
      {online && <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full border-2 border-surface bg-emerald-500" role="img" aria-label="Online" />}
    </span>
  );
}

export const Verified = ({ user }) => (user?.verifiedBadge ? <BadgeCheck className="inline h-4 w-4 text-brand-600" aria-label="Verified" /> : null);

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function PostSkeleton() {
  return (
    <div className="card space-y-3 p-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 !rounded-full" />
        <div className="space-y-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-20" /></div>
      </div>
      <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-40 w-full" />
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, hint, action }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="rounded-full bg-brand-50 p-3 text-brand-600 dark:bg-brand-500/15"><Icon className="h-6 w-6" /></span>
      <h3 className="font-semibold">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-mute">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertCircle className="h-6 w-6 text-red-500" />
      <p className="text-sm">{message || 'Something went wrong.'}</p>
      {onRetry && <button className="btn-soft" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 380 }}
            className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl outline-none sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-base font-bold">{title}</h2>
              <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(); onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={go}>{busy && <Spinner className="h-4 w-4" />}{confirmLabel}</button>
    </>}>
      <p className="text-sm text-mute">{message}</p>
    </Modal>
  );
}

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
export function Toasts() {
  const toasts = useSelector((s) => s.ui.toasts);
  const dispatch = useDispatch();
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => <ToastItem key={t.id} t={t} onDone={() => dispatch(dismissToast(t.id))} />)}
      </AnimatePresence>
    </div>,
    document.body
  );
}
function ToastItem({ t, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, t.kind === 'error' ? 6000 : 4000);
    return () => clearTimeout(id);
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const Icon = ICONS[t.kind] || Info;
  const tone = t.kind === 'error' ? 'text-red-500' : t.kind === 'success' ? 'text-emerald-500' : 'text-brand-600';
  return (
    <motion.div layout initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, scale: 0.95 }} role={t.kind === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-lg">
      <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
      <span className="min-w-0 break-words">{t.message}</span>
      <button onClick={onDone} aria-label="Dismiss" className="text-mute hover:text-ink"><X className="h-4 w-4" /></button>
    </motion.div>
  );
}

/** Small anchored dropdown. `items`: [{label, icon, onClick, danger, hidden}] */
export function Menu({ trigger, items, align = 'right', label = 'More options' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost !p-1.5" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{trigger}</button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            className={`absolute z-30 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {visible.map((i) => (
              <button key={i.label} role="menuitem" onClick={() => { setOpen(false); i.onClick(); }}
                className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-line/50 ${i.danger ? 'text-red-600 dark:text-red-400' : ''}`}>
                {i.icon && <i.icon className="h-4 w-4 shrink-0" />}{i.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }, []);
  return [busy, run];
}

export function Field({ label, error, children, hint }) {
  const id = useId();
  let wired = false;
  // the first form control inside gets the id so the label is programmatically associated with it
  const kids = Children.map(children, (c) => {
    if (!wired && isValidElement(c) && ['input', 'select', 'textarea'].includes(c.type)) {
      wired = true;
      return cloneElement(c, { id: c.props.id || id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-err` : undefined });
    }
    return c;
  });
  return (
    <div>
      {label && <label className="label" htmlFor={id}>{label}</label>}
      {kids}
      {hint && !error && <p className="mt-1 text-xs text-mute">{hint}</p>}
      {error && <p id={`${id}-err`} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`relative whitespace-nowrap px-4 py-3 text-sm font-semibold transition ${value === t.id ? 'text-brand-600' : 'text-mute hover:text-ink'}`}>
          {t.label}
          {value === t.id && <motion.span layoutId="tab-underline" className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand-600" />}
        </button>
      ))}
    </div>
  );
}
