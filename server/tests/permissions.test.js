import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, makeUser, makePost, befriend, client } from './helpers.js';

let t;
let alice; let bob; let carol; let stranger;
before(async () => {
  t = await setup();
  [alice, bob, carol, stranger] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
  await befriend(alice, bob);
  await befriend(alice, carol);
});
after(teardown);

const canSee = async (viewer, post) => (await viewer.api.get(`/api/posts/${post._id}`)).status === 200;
const inFeed = async (viewer, post) => (await viewer.api.get('/api/posts/feed?limit=30')).body.items.some((p) => p._id === post._id);
const onProfile = async (viewer, author, post) => (await viewer.api.get(`/api/posts/user/${author._id}?limit=30`)).body.items.some((p) => p._id === post._id);

describe('every route requires authentication', () => {
  const routes = [
    ['get', '/api/posts/feed'], ['get', '/api/friends'], ['get', '/api/notifications'], ['get', '/api/search/people?q=a'],
    ['post', '/api/posts'], ['put', '/api/reactions'], ['get', '/api/admin/stats'], ['get', '/api/saved'],
  ];
  for (const [method, url] of routes) {
    test(`${method.toUpperCase()} ${url}`, async () => {
      assert.equal((await t.request[method](url)).status, 401);
    });
  }
});

describe('post audiences', () => {
  test('public posts are visible to everyone', async () => {
    const post = await makePost(alice, { audience: 'public', text: 'public one' });
    assert.equal(await canSee(stranger, post), true);
    assert.equal(await canSee(bob, post), true);
  });

  test('friends-only posts: friends yes; strangers get 404 on every surface', async () => {
    const post = await makePost(alice, { audience: 'friends', text: 'friends only secret' });
    assert.equal(await canSee(bob, post), true);
    assert.equal(await inFeed(bob, post), true);
    assert.equal(await canSee(stranger, post), false);
    assert.equal(await onProfile(stranger, alice, post), false);
    const search = await stranger.api.get('/api/search/posts?q=friends only secret');
    assert.equal(search.body.items.some((p) => p._id === post._id), false);
    const explore = await stranger.api.get('/api/posts/explore?limit=30');
    assert.equal(explore.body.items.some((p) => p._id === post._id), false);
    // other write paths on a post you cannot see must not leak either
    assert.equal((await stranger.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'like' })).status, 404);
    assert.equal((await stranger.api.post(`/api/comments/post/${post._id}`, { text: 'hi' })).status, 404);
    assert.equal((await stranger.api.put(`/api/posts/${post._id}/save`, {})).status, 404);
  });

  test('only me', async () => {
    const post = await makePost(alice, { audience: 'only_me', text: 'diary' });
    assert.equal(await canSee(alice, post), true);
    assert.equal(await canSee(bob, post), false);
  });

  test('friends except: excluded friend cannot see it, other friends can', async () => {
    const post = await makePost(alice, { audience: 'friends_except', audienceList: [carol._id], text: 'not for carol' });
    assert.equal(await canSee(bob, post), true);
    assert.equal(await canSee(carol, post), false);
    assert.equal(await canSee(stranger, post), false);
  });

  test('specific friends: only the chosen ones can see it', async () => {
    const post = await makePost(alice, { audience: 'specific', audienceList: [bob._id], text: 'just bob' });
    assert.equal(await canSee(bob, post), true);
    assert.equal(await canSee(carol, post), false);
    assert.equal((await alice.api.post('/api/posts', { text: 'x', audience: 'specific', audienceList: [] })).status, 400);
  });

  test('audience lists cannot include non-friends', async () => {
    const post = await makePost(alice, { audience: 'specific', audienceList: [bob._id, stranger._id], text: 'bob and a stranger' });
    assert.equal(await canSee(stranger, post), false, 'non-friends are silently dropped from the list');
  });

  test('unfriending removes access immediately', async () => {
    const dave = await makeUser();
    await befriend(alice, dave);
    const post = await makePost(alice, { audience: 'friends', text: 'for friends' });
    assert.equal(await canSee(dave, post), true);
    assert.equal((await alice.api.delete(`/api/friends/${dave._id}`)).status, 200);
    assert.equal(await canSee(dave, post), false);
  });
});

describe('blocking', () => {
  test('a blocked user cannot see the blocker\'s profile or public posts, and vice versa', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const post = await makePost(a, { text: 'public but blocked' });
    const bPost = await makePost(b, { text: 'from the blocked one' });
    assert.equal(await canSee(b, post), true);

    assert.equal((await a.api.post(`/api/users/${b._id}/block`, {})).status, 200);
    assert.equal(await canSee(b, post), false);
    assert.equal((await b.api.get(`/api/profiles/${a.username}`)).status, 404);
    assert.equal((await a.api.get(`/api/profiles/${b.username}`)).status, 404);
    assert.equal(await canSee(a, bPost), false);
    assert.equal((await b.api.post(`/api/friends/requests/${a._id}`)).status, 404);
    const people = await b.api.get(`/api/search/people?q=${a.username}`);
    assert.equal(people.body.items.some((u) => u._id === a._id), false);

    assert.equal((await a.api.delete(`/api/users/${b._id}/block`)).status, 200);
    assert.equal(await canSee(b, post), true);
  });

  test('blocking severs an existing friendship and follows', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await befriend(a, b);
    await a.api.post(`/api/users/${b._id}/block`, {});
    await a.api.delete(`/api/users/${b._id}/block`);
    const rel = (await a.api.get(`/api/profiles/${b.username}`)).body.relationship;
    assert.equal(rel.friendship, 'none');
    assert.equal(rel.following, false);
  });
});

describe('ownership', () => {
  test('only the author can edit, delete, pin or review the audience of a post', async () => {
    const post = await makePost(alice, { text: 'mine' });
    assert.equal((await bob.api.patch(`/api/posts/${post._id}`, { text: 'hacked' })).status, 404);
    assert.equal((await bob.api.delete(`/api/posts/${post._id}`)).status, 403);
    assert.equal((await bob.api.put(`/api/posts/${post._id}/pin`, { pinned: true })).status, 404);
    assert.equal((await bob.api.get(`/api/posts/${post._id}/audience`)).status, 404);
    assert.equal((await alice.api.get(`/api/posts/${post._id}`)).body.text, 'mine');
  });

  test('comments: author or post owner may delete, others may not; only the author may edit', async () => {
    const post = await makePost(alice, { text: 'comment target' });
    const c = (await bob.api.post(`/api/comments/post/${post._id}`, { text: 'bob says hi' })).body.comment;
    assert.equal((await carol.api.delete(`/api/comments/${c._id}`)).status, 403);
    assert.equal((await alice.api.patch(`/api/comments/${c._id}`, { text: 'edited by owner' })).status, 404);
    assert.equal((await bob.api.patch(`/api/comments/${c._id}`, { text: 'bob edit' })).status, 200);
    assert.equal((await alice.api.delete(`/api/comments/${c._id}`)).status, 200, 'post owner can moderate');
  });

  test('only the post author can pin a comment', async () => {
    const post = await makePost(alice, { text: 'pin test' });
    const c = (await bob.api.post(`/api/comments/post/${post._id}`, { text: 'pin me' })).body.comment;
    assert.equal((await bob.api.put(`/api/comments/${c._id}/pin`, { pinned: true })).status, 403);
    assert.equal((await alice.api.put(`/api/comments/${c._id}/pin`, { pinned: true })).status, 200);
  });
});

describe('profile privacy', () => {
  test('friends-only profile hides everything from strangers but not friends', async () => {
    const p = await makeUser();
    const friend = await makeUser();
    const outsider = await makeUser();
    await befriend(p, friend);
    await makePost(p, { text: 'private-ish', audience: 'public' });
    assert.equal((await p.api.put('/api/profiles/me/privacy', { profileVisibility: 'friends' })).status, 200);

    const hidden = (await outsider.api.get(`/api/profiles/${p.username}`)).body;
    assert.equal(hidden.restricted, true);
    assert.equal(hidden.user.bio, undefined);
    assert.equal((await outsider.api.get(`/api/posts/user/${p._id}`)).body.restricted, true);

    const visible = (await friend.api.get(`/api/profiles/${p.username}`)).body;
    assert.equal(visible.restricted, undefined);
  });

  test('the friend list obeys its visibility setting', async () => {
    const p = await makeUser();
    const f = await makeUser();
    const outsider = await makeUser();
    await befriend(p, f);
    assert.equal((await outsider.api.get(`/api/friends/user/${p._id}`)).body.items.length, 1);
    await p.api.put('/api/profiles/me/privacy', { friendListVisibility: 'only_me' });
    const res = await outsider.api.get(`/api/friends/user/${p._id}`);
    assert.equal(res.body.restricted, true);
    assert.equal(res.body.items.length, 0);
    assert.equal((await p.api.get(`/api/friends/user/${p._id}`)).body.items.length, 1);
  });

  test('who-can settings are enforced: friend requests, comments and tags', async () => {
    const p = await makeUser();
    const other = await makeUser();
    await p.api.put('/api/profiles/me/privacy', { whoCanSendFriendRequests: 'nobody' });
    assert.equal((await other.api.post(`/api/friends/requests/${p._id}`)).status, 403);

    const post = await makePost(p, { text: 'no comments please' });
    await p.api.put('/api/profiles/me/privacy', { whoCanComment: 'nobody' });
    assert.equal((await other.api.post(`/api/comments/post/${post._id}`, { text: 'hello' })).status, 403);
    assert.equal((await p.api.post(`/api/comments/post/${post._id}`, { text: 'owner can' })).status, 201);

    const friend = await makeUser();
    const tagger = await makeUser();
    await befriend(tagger, friend);
    await friend.api.put('/api/profiles/me/privacy', { whoCanTag: 'nobody' });
    const tagged = await tagger.api.post('/api/posts', { text: 'tagging', audience: 'public', tags: [friend._id] });
    assert.equal(tagged.status, 201);
    assert.equal(tagged.body.tags.length, 0, 'a user who disallows tagging is not tagged');
    assert.equal((await tagger.api.post('/api/posts', { text: 'x', audience: 'public', tags: [stranger._id] })).status, 400, 'only friends can be tagged');
  });
});

describe('roles and moderation access', () => {
  test('regular users cannot reach admin endpoints', async () => {
    for (const url of ['/api/admin/stats', '/api/admin/users', '/api/admin/reports', '/api/admin/audit-logs']) {
      assert.equal((await alice.api.get(url)).status, 403, url);
    }
  });

  test('a role claim in the token cannot be forged; roles come from the database', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: alice._id, role: 'admin', fam: 'whatever' }, 'wrong-secret', { issuer: 'circle' });
    assert.equal((await t.request.get('/api/admin/stats').set('Authorization', `Bearer ${forged}`)).status, 401);
  });

  test('moderators can review reports but cannot change roles; admins can', async () => {
    const mod = await makeUser();
    const admin = await makeUser();
    const target = await makeUser();
    const users = t.mongoose.connection.collection('users');
    await users.updateOne({ username: mod.username }, { $set: { role: 'moderator' } });
    await users.updateOne({ username: admin.username }, { $set: { role: 'admin' } });

    assert.equal((await mod.api.get('/api/admin/reports')).status, 200);
    const denied = await mod.api.patch(`/api/admin/users/${target._id}`, { action: 'set_role', role: 'admin' });
    assert.equal(denied.status, 403);
    const ok = await admin.api.patch(`/api/admin/users/${target._id}`, { action: 'set_role', role: 'moderator' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.role, 'moderator');
    assert.equal((await admin.api.patch(`/api/admin/users/${admin._id}`, { action: 'ban' })).status, 400, 'admins cannot moderate themselves');
  });

  test('suspending a user kills their session and hides their posts; reinstating restores both', async () => {
    const admin = await makeUser();
    await t.mongoose.connection.collection('users').updateOne({ username: admin.username }, { $set: { role: 'admin' } });
    const bad = await makeUser();
    const viewer = await makeUser();
    const post = await makePost(bad, { text: 'about to be suspended' });
    assert.equal(await canSee(viewer, post), true);

    assert.equal((await admin.api.patch(`/api/admin/users/${bad._id}`, { action: 'suspend', reason: 'spam' })).status, 200);
    assert.equal((await bad.api.get('/api/auth/me')).status, 401);
    assert.equal(await canSee(viewer, post), false);
    const login = await t.request.post('/api/auth/login').send({ identifier: bad.email, password: bad.password });
    assert.equal(login.status, 403);

    assert.equal((await admin.api.patch(`/api/admin/users/${bad._id}`, { action: 'reinstate' })).status, 200);
    assert.equal(await canSee(viewer, post), true);
    const logs = await admin.api.get('/api/admin/audit-logs');
    assert.ok(logs.body.items.some((l) => l.action === 'user.suspend'));
  });

  test('reports reach the queue and moderators can remove the reported content', async () => {
    const mod = await makeUser();
    await t.mongoose.connection.collection('users').updateOne({ username: mod.username }, { $set: { role: 'moderator' } });
    const author = await makeUser();
    const reporter = await makeUser();
    const post = await makePost(author, { text: 'buy cheap pills now' });

    const rep = await reporter.api.post('/api/reports', { targetType: 'post', target: post._id, category: 'spam', details: 'obvious spam' });
    assert.equal(rep.status, 201);
    assert.equal((await reporter.api.post('/api/reports', { targetType: 'post', target: post._id, category: 'spam' })).body.duplicate, true);
    assert.equal((await reporter.api.post('/api/reports', { targetType: 'post', target: post._id, category: 'not-a-category' })).status, 400);

    const queue = (await mod.api.get('/api/admin/reports')).body.items;
    const mine = queue.find((r) => r.target === post._id);
    assert.ok(mine);
    assert.equal(mine.preview.text, 'buy cheap pills now');

    const res = await mod.api.patch(`/api/admin/reports/${mine._id}`, { status: 'resolved', removeContent: true, note: 'removed' });
    assert.equal(res.status, 200);
    assert.equal((await reporter.api.get(`/api/posts/${post._id}`)).status, 404);
  });
});

export { client };
