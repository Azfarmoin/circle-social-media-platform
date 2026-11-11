import { describe, it, expect } from 'vitest';
import { timeAgo, compact, plural, initials, tokenize } from '../src/lib/format.js';
import { notificationText } from '../src/lib/notifications.js';

describe('format helpers', () => {
  const now = new Date('2026-01-10T12:00:00Z').getTime();
  it('formats relative time', () => {
    expect(timeAgo('2026-01-10T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-01-10T11:30:00Z', now)).toBe('30m');
    expect(timeAgo('2026-01-10T09:00:00Z', now)).toBe('3h');
    expect(timeAgo('2026-01-08T12:00:00Z', now)).toBe('2d');
    expect(timeAgo('2025-12-20T12:00:00Z', now)).toBe('3w');
    expect(timeAgo(null, now)).toBe('');
  });
  it('compacts counts', () => {
    expect(compact(999)).toBe('999');
    expect(compact(1500)).toBe('1.5K');
    expect(compact(12000)).toBe('12K');
    expect(compact(2_300_000)).toBe('2.3M');
  });
  it('pluralises and builds initials', () => {
    expect(plural(1, 'comment')).toBe('1 comment');
    expect(plural(2, 'reply', 'replies')).toBe('2 replies');
    expect(initials('Ada Lovelace King')).toBe('AL');
    expect(initials('')).toBe('?');
  });
  it('tokenizes hashtags, mentions and links without producing HTML', () => {
    const parts = tokenize('Hi @sara_k see #Summer2026 at https://example.com/x?y=1 <script>alert(1)</script>');
    expect(parts.filter((p) => p.t !== 'text').map((p) => [p.t, p.v])).toEqual([
      ['mention', 'sara_k'], ['tag', 'Summer2026'], ['url', 'https://example.com/x?y=1'],
    ]);
    // markup stays inert text; React escapes it when rendered
    expect(parts.some((p) => p.t === 'text' && p.v.includes('<script>'))).toBe(true);
  });
  it('describes notifications', () => {
    expect(notificationText({ type: 'comment', actor: { name: 'Ben' } })).toBe('Ben commented on your post');
    expect(notificationText({ type: 'reaction', actor: { name: 'Ben' }, meta: { reaction: 'love', targetType: 'comment' } })).toContain('comment');
  });
});
