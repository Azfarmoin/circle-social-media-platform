import { describe, it, expect } from 'vitest';
import { makeStore } from '../src/store/index.js';
import { upsertPosts, applyReaction, patchPost, removePost, pollUpdate, pushToast, dismissToast, received, clearUnread, signedIn, signedOut, postSelectors } from '../src/store/slices.js';

const post = (over = {}) => ({ _id: 'p1', myReaction: null, reactionCounts: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 }, reactionTotal: 0, commentCount: 0, ...over });

describe('posts slice', () => {
  it('applies optimistic reactions and switches between types', () => {
    const s = makeStore();
    s.dispatch(upsertPosts([post()]));
    s.dispatch(applyReaction({ id: 'p1', type: 'like' }));
    expect(s.getState().posts.entities.p1).toMatchObject({ myReaction: 'like', reactionTotal: 1 });
    s.dispatch(applyReaction({ id: 'p1', type: 'love' }));
    let p = s.getState().posts.entities.p1;
    expect(p.reactionCounts).toMatchObject({ like: 0, love: 1 });
    expect(p.reactionTotal).toBe(1);
    s.dispatch(applyReaction({ id: 'p1', type: null }));
    p = s.getState().posts.entities.p1;
    expect(p.reactionTotal).toBe(0);
    expect(p.myReaction).toBeNull();
  });
  it('never lets counters go negative', () => {
    const s = makeStore();
    s.dispatch(upsertPosts([post({ myReaction: 'like' })]));
    s.dispatch(applyReaction({ id: 'p1', type: null }));
    expect(s.getState().posts.entities.p1.reactionTotal).toBe(0);
    expect(s.getState().posts.entities.p1.reactionCounts.like).toBe(0);
  });
  it('patches, updates polls from the socket and removes posts', () => {
    const s = makeStore();
    s.dispatch(upsertPosts([post({ poll: { options: [], totalVotes: 0, myVote: [] } })]));
    s.dispatch(patchPost({ id: 'p1', changes: { commentCount: 4 } }));
    s.dispatch(pollUpdate({ postId: 'p1', options: [{ _id: 'a', count: 2 }], totalVotes: 2 }));
    const p = postSelectors.selectById(s.getState(), 'p1');
    expect(p.commentCount).toBe(4);
    expect(p.poll).toMatchObject({ totalVotes: 2, myVote: [] });
    s.dispatch(removePost('p1'));
    expect(postSelectors.selectById(s.getState(), 'p1')).toBeUndefined();
  });
  it('ignores updates for posts that are not loaded', () => {
    const s = makeStore();
    s.dispatch(patchPost({ id: 'nope', changes: { commentCount: 1 } }));
    s.dispatch(applyReaction({ id: 'nope', type: 'like' }));
    expect(s.getState().posts.ids).toEqual([]);
  });
});

describe('auth, toasts and notifications', () => {
  it('tracks the signed-in user', () => {
    const s = makeStore();
    expect(s.getState().auth.status).toBe('booting');
    s.dispatch(signedIn({ _id: 'u1' }));
    expect(s.getState().auth).toMatchObject({ status: 'in', user: { _id: 'u1' } });
    s.dispatch(signedOut());
    expect(s.getState().auth).toMatchObject({ status: 'out', user: null });
  });
  it('keeps at most four toasts and dismisses by id', () => {
    const s = makeStore();
    for (let i = 0; i < 6; i++) s.dispatch(pushToast(`m${i}`));
    const toasts = s.getState().ui.toasts;
    expect(toasts).toHaveLength(4);
    s.dispatch(dismissToast(toasts[0].id));
    expect(s.getState().ui.toasts).toHaveLength(3);
  });
  it('counts live notifications', () => {
    const s = makeStore();
    s.dispatch(received({ _id: 'n1' }));
    s.dispatch(received({ _id: 'n2' }));
    expect(s.getState().notifications.unread).toBe(2);
    s.dispatch(clearUnread());
    expect(s.getState().notifications.unread).toBe(0);
  });
});
