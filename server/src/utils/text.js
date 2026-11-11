// Text hygiene helpers. React escapes on render, but stored text is also stripped of markup
// and control characters so it is safe in emails, notifications and any non-React consumer.

const TAG_RE = /<\/?[a-z!][^>]*>/gi;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const cleanText = (value = '') =>
  String(value).replace(CONTROL_RE, '').replace(TAG_RE, '').replace(/javascript:/gi, '').trim();

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const extractHashtags = (text = '', max = 10) => {
  const found = new Set();
  for (const m of text.matchAll(/(?:^|[^\w&])#([\p{L}\p{N}_]{2,40})/gu)) {
    found.add(m[1].toLowerCase());
    if (found.size >= max) break;
  }
  return [...found];
};

export const extractMentions = (text = '', max = 20) => {
  const found = new Set();
  for (const m of text.matchAll(/(?:^|[^\w])@([a-z0-9_]{3,30})/gi)) {
    found.add(m[1].toLowerCase());
    if (found.size >= max) break;
  }
  return [...found];
};

export const deviceLabel = (ua = '') => {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Unknown browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
};
