import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, makeUser, makePost, befriend } from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(teardown);

const reload = async (viewer, id) => (await viewer.api.get(`/api/posts/${id}`)).body;
const me = async (u) => (await u.api.get('/api/auth/me')).body.user;

describe('friend requests', () => {
  test('send, list, accept: both users become friends with mutual follows and correct counts', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const sent = await a.api.post(`/api/friends/requests/${b._id}`);
    assert.equal(sent.status, 201);
    assert.equal(sent.body.status, 'request_sent');

    assert.equal((await a.api.get('/api/friends/requests?direction=outgoing')).body.items.length, 1);
    const incoming = (await b.api.get('/api/friends/requests')).body.items;
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].user.username, a.username);
    assert.equal((await b.api.get(`/api/profiles/${a.username}`)).body.relationship.friendship, 'request_received');
    assert.ok((await b.api.get('/api/notifications')).body.items.some((n) => n.type === 'friend_request'));

    assert.equal((await a.api.post(`/api/friends/requests/${sent.body.requestId}/accept`)).status, 404, 'only the recipient can accept');
    assert.equal((await b.api.post(`/api/friends/requests/${sent.body.requestId}/accept`)).status, 200);

    assert.equal((await me(a)).friendCount, 1);
    assert.equal((await me(b)).friendCount, 1);
    assert.equal((await me(a)).followingCount, 1);
    assert.equal((await me(b)).followerCount, 1);
    assert.ok((await a.api.get('/api/notifications')).body.items.some((n) => n.type === 'friend_accept'));
    assert.equal((await a.api.get('/api/friends')).body.items[0].username, b.username);
    assert.equal((await a.api.post(`/api/friends/requests/${b._id}`)).status, 409, 'already friends');
  });

  test('reject and cancel', async () => {
    const a = await makeUser(); const b = await makeUser(); const c = await makeUser();
    const r1 = await a.api.post(`/api/friends/requests/${b._id}`);
    assert.equal((await b.api.post(`/api/friends/requests/${r1.body.requestId}/reject`)).status, 200);
    assert.equal((await b.api.get('/api/friends/requests')).body.items.length, 0);
    assert.equal((await me(b)).friendCount, 0);

    const r2 = await a.api.post(`/api/friends/requests/${c._id}`);
    assert.equal((await c.api.delete(`/api/friends/requests/${r2.body.requestId}`)).status, 404, 'recipient cannot "cancel"');
    assert.equal((await a.api.delete(`/api/friends/requests/${r2.body.requestId}`)).status, 200);
    assert.equal((await c.api.get('/api/friends/requests')).body.items.length, 0);
    // after a rejection the sender may try again
    assert.equal((await a.api.post(`/api/friends/requests/${b._id}`)).status, 201);
  });

  test('a crossing request auto-accepts', async () => {
    const a = await makeUser(); const b = await makeUser();
    await a.api.post(`/api/friends/requests/${b._id}`);
    const back = await b.api.post(`/api/friends/requests/${a._id}`);
    assert.equal(back.body.status, 'friends');
    assert.equal((await me(a)).friendCount, 1);
  });

  test('cannot befriend yourself or a missing user', async () => {
    const a = await makeUser();
    assert.equal((await a.api.post(`/api/friends/requests/${a._id}`)).status, 400);
    assert.equal((await a.api.post(`/api/friends/requests/${'a'.repeat(24)}`)).status, 404);
    assert.equal((await a.api.post('/api/friends/requests/not-an-id')).status, 400);
  });

  test('removing a friend updates counts on both sides and drops the follows', async () => {
    const a = await makeUser(); const b = await makeUser();
    await befriend(a, b);
    assert.equal((await a.api.delete(`/api/friends/${b._id}`)).status, 200);
    assert.equal((await me(a)).friendCount, 0);
    assert.equal((await me(b)).friendCount, 0);
    assert.equal((await me(a)).followingCount, 0);
    assert.equal((await a.api.delete(`/api/friends/${b._id}`)).status, 404);
  });

  test('mutual friends and suggestions (friends of friends first)', async () => {
    const a = await makeUser(); const b = await makeUser(); const c = await makeUser(); const d = await makeUser();
    await befriend(a, b); await befriend(b, c); await befriend(a, d); await befriend(d, c);
    const mutual = (await a.api.get(`/api/friends/mutual/${c._id}`)).body;
    assert.equal(mutual.total, 2);
    const sug = (await a.api.get('/api/friends/suggestions')).body.items;
    const hit = sug.find((u) => u._id === c._id);
    assert.ok(hit, 'friend of friends suggested');
    assert.equal(hit.mutualCount, 2);
    assert.ok(!sug.some((u) => u._id === b._id || u._id === a._id), 'never suggests friends or yourself');
  });

  test('follow and unfollow adjust counters and are idempotent', async () => {
    const a = await makeUser(); const b = await makeUser();
    await a.api.post(`/api/follow/${b._id}`);
    await a.api.post(`/api/follow/${b._id}`);
    assert.equal((await me(b)).followerCount, 1);
    assert.equal((await b.api.get(`/api/follow/followers/${b._id}`)).body.items[0].username, a.username);
    assert.equal((await a.api.get(`/api/follow/following/${a._id}`)).body.items.length, 1);
    await a.api.delete(`/api/follow/${b._id}`);
    await a.api.delete(`/api/follow/${b._id}`);
    assert.equal((await me(b)).followerCount, 0);
    await b.api.put('/api/profiles/me/privacy', { whoCanFollow: 'nobody' });
    assert.equal((await a.api.post(`/api/follow/${b._id}`)).status, 403);
  });
});

describe('comments', () => {
  test('top-level comments, replies, reply-to-reply flattening and exact counts', async () => {
    const author = await makeUser(); const other = await makeUser();
    const post = await makePost(author, { text: 'discussion' });

    const c1 = (await other.api.post(`/api/comments/post/${post._id}`, { text: 'first!' })).body.comment;
    const r1 = (await author.api.post(`/api/comments/post/${post._id}`, { text: 'thanks', parentId: c1._id })).body.comment;
    assert.equal(r1.parent, c1._id);
    assert.equal(r1.replyTo.username, other.username);
    const r2 = (await other.api.post(`/api/comments/post/${post._id}`, { text: 'replying to the reply', parentId: r1._id })).body.comment;
    assert.equal(r2.parent, c1._id, 'replies stay one level deep');
    assert.equal(r2.replyTo.username, author.username);

    const fresh = await reload(author, post._id);
    assert.equal(fresh.commentCount, 3);
    const top = (await author.api.get(`/api/comments/post/${post._id}`)).body;
    assert.equal(top.items.length, 1, 'replies are not in the top-level list');
    assert.equal(top.items[0].replyCount, 2);
    const replies = (await author.api.get(`/api/comments/${c1._id}/replies`)).body.items;
    assert.deepEqual(replies.map((r) => r.text), ['thanks', 'replying to the reply'], 'replies are oldest first');

    assert.equal((await other.api.post(`/api/comments/post/${post._id}`, { text: 'x', parentId: 'f'.repeat(24) })).status, 404);
    assert.equal((await other.api.post(`/api/comments/post/${post._id}`, { text: '   ' })).status, 400);
  });

  test('notifications: comment, reply and mention each go to the right person once', async () => {
    const author = await makeUser(); const a = await makeUser(); const b = await makeUser();
    const post = await makePost(author, { text: 'notify test' });
    const c = (await a.api.post(`/api/comments/post/${post._id}`, { text: 'hello' })).body.comment;
    await b.api.post(`/api/comments/post/${post._id}`, { text: `hey @${a.username}`, parentId: c._id });
    const authorNotes = (await author.api.get('/api/notifications')).body.items.filter((n) => n.post === post._id);
    assert.equal(authorNotes.filter((n) => n.type === 'comment').length, 2);
    const aNotes = (await a.api.get('/api/notifications')).body.items;
    assert.equal(aNotes.filter((n) => n.type === 'reply').length, 1, 'a is notified once even though also mentioned');
    assert.equal(aNotes.filter((n) => n.type === 'mention').length, 0);
  });

  test('sorting: newest, oldest and top; pinned comment leads the first page', async () => {
    const author = await makeUser(); const x = await makeUser(); const y = await makeUser();
    const post = await makePost(author, { text: 'sorting' });
    const ids = [];
    for (const text of ['one', 'two', 'three']) ids.push((await x.api.post(`/api/comments/post/${post._id}`, { text })).body.comment._id);
    await y.api.put('/api/reactions', { targetType: 'comment', target: ids[0], type: 'like' });
    await author.api.put('/api/reactions', { targetType: 'comment', target: ids[0], type: 'love' });
    await y.api.put('/api/reactions', { targetType: 'comment', target: ids[1], type: 'like' });

    const order = async (sort) => (await author.api.get(`/api/comments/post/${post._id}?sort=${sort}`)).body.items.map((c) => c.text);
    assert.deepEqual(await order('newest'), ['three', 'two', 'one']);
    assert.deepEqual(await order('oldest'), ['one', 'two', 'three']);
    assert.deepEqual((await order('top')).slice(0, 2), ['one', 'two']);

    await author.api.put(`/api/comments/${ids[2]}/pin`, { pinned: true });
    const pinned = (await author.api.get(`/api/comments/post/${post._id}?sort=oldest`)).body.items;
    assert.equal(pinned[0].text, 'three');
    assert.equal(pinned[0].pinned, true);
    assert.equal(pinned.length, 3, 'the pinned comment is not duplicated');
  });

  test('comment pagination uses cursors and never repeats', async () => {
    const author = await makeUser();
    const post = await makePost(author, { text: 'long thread' });
    for (let i = 0; i < 14; i++) await author.api.post(`/api/comments/post/${post._id}`, { text: `c${i}` });
    const seen = [];
    let cursor = null;
    do {
      const res = (await author.api.get(`/api/comments/post/${post._id}?sort=oldest&limit=5${cursor ? `&cursor=${cursor}` : ''}`)).body;
      seen.push(...res.items.map((c) => c.text));
      cursor = res.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, Array.from({ length: 14 }, (_, i) => `c${i}`));
    const topPages = [];
    cursor = null;
    do {
      const res = (await author.api.get(`/api/comments/post/${post._id}?sort=top&limit=5${cursor ? `&cursor=${cursor}` : ''}`)).body;
      topPages.push(...res.items.map((c) => c._id));
      cursor = res.nextCursor;
    } while (cursor);
    assert.equal(new Set(topPages).size, 14);
  });

  test('editing sets editedAt; deleting a thread removes replies and fixes counts', async () => {
    const author = await makeUser(); const other = await makeUser();
    const post = await makePost(author, { text: 'delete thread' });
    const c = (await other.api.post(`/api/comments/post/${post._id}`, { text: 'orig' })).body.comment;
    await author.api.post(`/api/comments/post/${post._id}`, { text: 'reply 1', parentId: c._id });
    await author.api.post(`/api/comments/post/${post._id}`, { text: 'reply 2', parentId: c._id });
    await other.api.put('/api/reactions', { targetType: 'comment', target: c._id, type: 'wow' });

    const edited = await other.api.patch(`/api/comments/${c._id}`, { text: 'edited' });
    assert.equal(edited.body.text, 'edited');
    assert.ok(edited.body.editedAt);

    assert.equal((await reload(author, post._id)).commentCount, 3);
    const del = await other.api.delete(`/api/comments/${c._id}`);
    assert.equal(del.body.commentCount, 0);
    assert.equal((await t.mongoose.connection.collection('reactions').countDocuments({ target: new t.mongoose.Types.ObjectId(c._id) })), 0);

    const c2 = (await other.api.post(`/api/comments/post/${post._id}`, { text: 'again' })).body.comment;
    const r = (await author.api.post(`/api/comments/post/${post._id}`, { text: 'reply', parentId: c2._id })).body.comment;
    await author.api.delete(`/api/comments/${r._id}`);
    const top = (await author.api.get(`/api/comments/post/${post._id}`)).body.items;
    assert.equal(top[0].replyCount, 0);
    assert.equal((await reload(author, post._id)).commentCount, 1);
  });
});

describe('reactions', () => {
  test('set, change, remove: counts always equal reality', async () => {
    const author = await makeUser(); const a = await makeUser(); const b = await makeUser();
    const post = await makePost(author, { text: 'react to me' });

    const r1 = await a.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.reactionTotal, 1);
    assert.equal(r1.body.reactionCounts.like, 1);

    const same = await a.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' });
    assert.equal(same.body.reactionTotal, 1, 'repeating the same reaction is idempotent');

    const changed = await a.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'angry' });
    assert.equal(changed.body.reactionTotal, 1);
    assert.equal(changed.body.reactionCounts.like, 0);
    assert.equal(changed.body.reactionCounts.angry, 1);

    await b.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'love' });
    const mid = await reload(a, post._id);
    assert.equal(mid.reactionTotal, 2);
    assert.equal(mid.myReaction, 'angry');
    assert.equal((await reload(b, post._id)).myReaction, 'love');

    const removed = await a.api.delete(`/api/reactions?targetType=post&target=${post._id}`);
    assert.equal(removed.body.reactionTotal, 1);
    assert.equal(removed.body.myReaction, null);
    const again = await a.api.delete(`/api/reactions?targetType=post&target=${post._id}`);
    assert.equal(again.body.reactionTotal, 1, 'removing twice does not go negative');

    // the stored counters match the reaction rows
    const rows = await t.mongoose.connection.collection('reactions').countDocuments({ target: new t.mongoose.Types.ObjectId(post._id) });
    assert.equal(rows, (await reload(author, post._id)).reactionTotal);
  });

  test('all six reaction types work; invalid ones are rejected', async () => {
    const author = await makeUser();
    const post = await makePost(author, { text: 'six' });
    for (const type of ['like', 'love', 'haha', 'wow', 'sad', 'angry']) {
      const u = await makeUser();
      assert.equal((await u.api.put('/api/reactions', { targetType: 'post', target: post._id, type })).status, 200);
    }
    const fresh = await reload(author, post._id);
    assert.equal(fresh.reactionTotal, 6);
    assert.ok(Object.values(fresh.reactionCounts).every((n) => n === 1));
    assert.equal((await author.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'meh' })).status, 400);
  });

  // Real MongoDB guarantees atomic $inc. FerretDB (used only as a stand-in test database where mongod
  // cannot be installed) loses some concurrent increments, so this one test is skipped there:
  //   TEST_DB_LOSES_CONCURRENT_INC=true npm test
  const lossy = process.env.TEST_DB_LOSES_CONCURRENT_INC === 'true' && 'test database does not guarantee atomic concurrent $inc';
  test('concurrent reactions from many users are all counted', { skip: lossy }, async () => {
    const author = await makeUser();
    const post = await makePost(author, { text: 'stampede' });
    const crowd = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    await Promise.all(crowd.map((u, i) => u.api.put('/api/reactions', { targetType: 'post', target: post._id, type: i % 2 ? 'love' : 'haha' })));
    const fresh = await reload(author, post._id);
    assert.equal(fresh.reactionTotal, 8);
    assert.equal(fresh.reactionCounts.love + fresh.reactionCounts.haha, 8);
  });

  test('breakdown lists who reacted, filterable by type, with cursors', async () => {
    const author = await makeUser(); const a = await makeUser(); const b = await makeUser();
    const post = await makePost(author, { text: 'who reacted' });
    await a.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'love' });
    await b.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'wow' });
    const all = (await author.api.get(`/api/reactions?targetType=post&target=${post._id}`)).body;
    assert.equal(all.items.length, 2);
    assert.equal(all.breakdown.reactionTotal, 2);
    const loves = (await author.api.get(`/api/reactions?targetType=post&target=${post._id}&type=love`)).body.items;
    assert.equal(loves.length, 1);
    assert.equal(loves[0].user.username, a.username);
    const page = (await author.api.get(`/api/reactions?targetType=post&target=${post._id}&limit=1`)).body;
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
  });

  test('reacting notifies the owner once, updating the notification when the reaction changes', async () => {
    const author = await makeUser(); const a = await makeUser();
    const post = await makePost(author, { text: 'notif reaction' });
    await a.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' });
    await a.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'love' });
    const notes = (await author.api.get('/api/notifications')).body.items.filter((n) => n.type === 'reaction');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].meta.reaction, 'love');
    await author.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' });
    assert.equal((await author.api.get('/api/notifications')).body.items.filter((n) => n.type === 'reaction').length, 1, 'no self-notification');
  });
});

describe('notifications', () => {
  test('unread count, mark read, delete, pagination and preferences', async () => {
    const author = await makeUser();
    const post = await makePost(author, { text: 'noise' });
    for (let i = 0; i < 5; i++) {
      const u = await makeUser();
      await u.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' });
    }
    assert.equal((await author.api.get('/api/notifications/unread-count')).body.unread, 5);
    const page = (await author.api.get('/api/notifications?limit=2')).body;
    assert.equal(page.items.length, 2);
    assert.ok(page.nextCursor);
    assert.equal(page.unread, 5);

    const first = page.items[0]._id;
    assert.equal((await author.api.post('/api/notifications/read', { ids: [first] })).body.unread, 4);
    assert.equal((await author.api.get('/api/notifications?unread=true')).body.items.length, 4);
    assert.equal((await author.api.delete(`/api/notifications/${first}`)).body.unread, 4);
    assert.equal((await author.api.post('/api/notifications/read', {})).body.unread, 0);

    await author.api.put('/api/profiles/me/notification-preferences', { reaction: false });
    const quiet = await makeUser();
    await quiet.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'wow' });
    assert.equal((await author.api.get('/api/notifications/unread-count')).body.unread, 0, 'muted type is not delivered');
  });

  test('users can only read and delete their own notifications', async () => {
    const author = await makeUser(); const other = await makeUser();
    const post = await makePost(author, { text: 'private notifs' });
    await other.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' });
    const note = (await author.api.get('/api/notifications')).body.items[0];
    assert.equal((await other.api.get('/api/notifications')).body.items.length, 0);
    await other.api.delete(`/api/notifications/${note._id}`);
    assert.equal((await author.api.get('/api/notifications')).body.items.length, 1);
  });
});

describe('search', () => {
  test('finds people by username prefix and by name word, ranks friends first, hides self-excluded blocks', async () => {
    const seeker = await makeUser();
    const tag = `zq${Date.now().toString(36).slice(-5)}`;
    const stranger = await makeUser({ username: `${tag}stranger`, name: 'Alpha Person' });
    const friend = await makeUser({ username: `${tag}friend`, name: 'Beta Person' });
    await befriend(seeker, friend);

    const byPrefix = (await seeker.api.get(`/api/search/people?q=${tag}`)).body.items;
    assert.deepEqual(byPrefix.map((u) => u.username), [friend.username, stranger.username]);
    const byName = (await seeker.api.get('/api/search/people?q=Beta')).body.items;
    assert.ok(byName.some((u) => u._id === friend._id));
    const suggest = (await seeker.api.get(`/api/search/suggest?q=${tag}`)).body;
    assert.equal(suggest.people.length, 2);
  });

  test('search terms are escaped as text, not interpreted as regex', async () => {
    const u = await makeUser();
    const res = await u.api.get('/api/search/people?q=.*');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 0);
    assert.equal((await u.api.get('/api/search/people?q=(((')).status, 200);
    assert.equal((await u.api.get('/api/search/people')).status, 400);
  });

  test('post search respects privacy; recent searches are stored, de-duplicated and clearable', async () => {
    const author = await makeUser(); const friend = await makeUser(); const stranger = await makeUser();
    await befriend(author, friend);
    const word = `quokka${Date.now().toString(36)}`;
    await makePost(author, { text: `a ${word} appears`, audience: 'friends' });
    assert.equal((await friend.api.get(`/api/search/posts?q=${word}`)).body.items.length, 1);
    assert.equal((await stranger.api.get(`/api/search/posts?q=${word}`)).body.items.length, 0);

    await friend.api.post('/api/search/recent', { term: 'cats' });
    await friend.api.post('/api/search/recent', { term: 'dogs' });
    const items = (await friend.api.post('/api/search/recent', { term: 'Cats' })).body.items;
    assert.deepEqual(items, ['Cats', 'dogs']);
    assert.deepEqual((await friend.api.delete('/api/search/recent?term=dogs')).body.items, ['Cats']);
    assert.deepEqual((await friend.api.delete('/api/search/recent')).body.items, []);
  });
});
