import { useState } from 'react';
import { Globe, Users, Lock, UserMinus, UserCheck } from 'lucide-react';
import { AUDIENCES, AUDIENCE_LABELS } from '@shared/constants.js';
import { friendApi } from '../../api/index.js';
import { Modal, Avatar, Spinner } from '../ui/index.jsx';
import Sentinel from '../ui/Sentinel.jsx';
import { useInfinite } from '../../lib/hooks.js';

export const AUDIENCE_ICON = { public: Globe, friends: Users, friends_except: UserMinus, specific: UserCheck, only_me: Lock };

function FriendPicker({ open, title, selected, onDone, onClose }) {
  const [sel, setSel] = useState(selected);
  const list = useInfinite((cursor) => friendApi.list({ cursor, limit: 30 }), [open]);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn-primary" onClick={() => onDone(sel)}>Done ({sel.length})</button>
    </>}>
      <ul className="space-y-1">
        {list.items.map((f) => (
          <li key={f._id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-line/50">
              <input type="checkbox" checked={sel.includes(f._id)} onChange={() => toggle(f._id)} className="h-4 w-4 accent-indigo-600" />
              <Avatar user={f} size={32} /><span className="text-sm font-medium">{f.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {list.loading && !list.items.length && <div className="flex justify-center py-6"><Spinner /></div>}
      {list.empty && <p className="py-6 text-center text-sm text-mute">You have no friends to choose from yet.</p>}
      <Sentinel loading={list.loading} done={list.done} error={list.error} onMore={list.loadMore} />
    </Modal>
  );
}

/** value: { audience, audienceList } */
export default function AudienceSelect({ value, onChange, compact }) {
  const [picking, setPicking] = useState(false);
  const Icon = AUDIENCE_ICON[value.audience] || Globe;
  const change = (audience) => {
    onChange({ audience, audienceList: [] });
    if (audience === 'friends_except' || audience === 'specific') setPicking(true);
  };
  const needsList = value.audience === 'friends_except' || value.audience === 'specific';
  return (
    <>
      <label className="relative inline-flex items-center gap-1.5 rounded-lg bg-line/60 px-2.5 py-1 text-xs font-semibold">
        <Icon className="h-3.5 w-3.5" />
        <select aria-label="Audience" style={{ width: `${AUDIENCE_LABELS[value.audience].length + 2}ch` }} value={value.audience} onChange={(e) => change(e.target.value)} className="cursor-pointer appearance-none bg-transparent pr-1 outline-none">
          {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>)}
        </select>
        {needsList && !compact && (
          <button type="button" className="ml-1 text-brand-600 hover:underline" onClick={() => setPicking(true)}>{value.audienceList.length} chosen</button>
        )}
      </label>
      {picking && (
        <FriendPicker open title={value.audience === 'specific' ? 'Share with specific friends' : 'Hide from these friends'} selected={value.audienceList}
          onClose={() => setPicking(false)} onDone={(audienceList) => { onChange({ ...value, audienceList }); setPicking(false); }} />
      )}
    </>
  );
}
