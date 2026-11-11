import { useState } from 'react';
import { UserPlus, UserCheck, UserX, Clock, Check, X } from 'lucide-react';
import { friendApi } from '../../api/index.js';
import { errorMessage } from '../../api/http.js';
import { Spinner } from '../ui/index.jsx';
import { useToast } from '../../lib/hooks.js';

/** Friend-request state machine: none → request_sent → friends, or request_received → friends. */
export default function FriendActions({ userId, initial = 'none', requestId: initialRequest = null, onChange, size = 'md', compact = false }) {
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [requestId, setRequestId] = useState(initialRequest);
  const [busy, setBusy] = useState(false);
  const pad = size === 'sm' ? '!px-3 !py-1.5' : '';
  const run = async (fn, next, nid = null) => {
    setBusy(true);
    try {
      const res = await fn();
      const resolved = typeof next === 'function' ? next(res) : next;
      setState(resolved); setRequestId(res?.requestId || nid);
      onChange?.(resolved);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  const spin = busy && <Spinner className="h-4 w-4" />;
  // compact: icon-only on tight layouts; the text stays for screen readers
  const L = (t) => <span className={compact ? 'sr-only' : ''}>{t}</span>;
  const cpad = compact ? '!px-2.5 !py-2' : pad;

  if (state === 'friends') {
    return <button className={`btn-soft ${cpad}`} disabled={busy} onClick={() => confirm('Remove this friend?') && run(() => friendApi.remove(userId), 'none')}>{spin || <UserCheck className="h-4 w-4" />}{L('Friends')}</button>;
  }
  if (state === 'request_sent') {
    return <button className={`btn-soft ${cpad}`} disabled={busy} onClick={() => run(() => friendApi.cancel(requestId), 'none')}>{spin || <Clock className="h-4 w-4" />}{L('Cancel request')}</button>;
  }
  if (state === 'request_received') {
    return (
      <span className="inline-flex gap-2">
        <button className={`btn-primary ${cpad}`} disabled={busy} onClick={() => run(() => friendApi.accept(requestId), 'friends')}>{spin || <Check className="h-4 w-4" />}{L('Confirm')}</button>
        <button className={`btn-ghost ${cpad}`} disabled={busy} onClick={() => run(() => friendApi.reject(requestId), 'none')}><X className="h-4 w-4" />{L('Delete')}</button>
      </span>
    );
  }
  return <button className={`btn-primary ${cpad}`} disabled={busy} onClick={() => run(() => friendApi.send(userId), (r) => (r.status === 'friends' ? 'friends' : 'request_sent'))}>{spin || <UserPlus className="h-4 w-4" />}{L('Add friend')}</button>;
}

export { UserX };
