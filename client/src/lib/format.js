const UNITS = [['y', 31536000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]];

export function timeAgo(value, now = Date.now()) {
  if (!value) return '';
  const s = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (s < 45) return 'just now';
  for (const [label, size] of UNITS) {
    if (s >= size) return `${Math.floor(s / size)}${label}`;
  }
  return 'just now';
}

export const fullDate = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function compact(n = 0) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

// Splits text into plain, #hashtag and @mention parts so the UI can link them without ever using innerHTML.
export function tokenize(text = '') {
  const out = [];
  const re = /(#[\p{L}\p{N}_]{2,40})|(@[a-z0-9_]{3,30})|(https?:\/\/[^\s<>"']+)/giu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'tag', v: m[1].slice(1) });
    else if (m[2]) out.push({ t: 'mention', v: m[2].slice(1) });
    else out.push({ t: 'url', v: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export const assetUrl = (u) => u || '';
