import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { setup, teardown, makeUser, makePost, befriend, PNG_1PX, uniq } from './helpers.js';

let t;
let alice; let bob;
before(async () => {
  t = await setup();
  [alice, bob] = await Promise.all([makeUser(), makeUser()]);
  await befriend(alice, bob);
});
after(teardown);

describe('creating posts', () => {
  test('text post with hashtags, mentions and feeling', async () => {
    const tag = uniq('tag');
    const res = await alice.api.post('/api/posts', { text: `Shipping #${tag} with @${bob.username} today`, audience: 'friends', feeling: 'excited', location: 'Lahore' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.hashtags, [tag]);
    assert.equal(res.body.feeling.label, 'excited');
    assert.equal(res.body.location, 'Lahore');
    assert.equal(res.body.author.username, alice.username);
    assert.equal(res.body.reactionTotal, 0);

    const note = (await bob.api.get('/api/notifications')).body.items.find((n) => n.type === 'mention');
    assert.ok(note, 'mentioned user is notified');
    assert.equal(note.actor.username, alice.username);

    const byTag = await bob.api.get(`/api/posts/hashtag/${tag}`);
    assert.equal(byTag.body.items.length, 1);
    const trending = await bob.api.get('/api/search/trending');
    assert.ok(trending.body.items.some((h) => h.tag === tag));
  });

  test('empty posts and unknown feelings are rejected', async () => {
    assert.equal((await alice.api.post('/api/posts', { text: '   ' })).status, 400);
    assert.equal((await alice.api.post('/api/posts', { text: 'x', feeling: 'not-real' })).status, 400);
    assert.equal((await alice.api.post('/api/posts', { text: 'x', audience: 'galaxy' })).status, 400);
  });

  test('the default audience comes from privacy settings', async () => {
    const u = await makeUser();
    assert.equal((await u.api.post('/api/posts', { text: 'default' })).body.audience, 'friends');
    await u.api.put('/api/profiles/me/privacy', { defaultPostAudience: 'public' });
    assert.equal((await u.api.post('/api/posts', { text: 'now public' })).body.audience, 'public');
  });

  test('photo posts: multiple images are stored with server-chosen names and served safely', async () => {
    const res = await alice.api.raw('post', '/api/posts').field('text', 'two photos').field('audience', 'public').attach('images', PNG_1PX, { filename: '../../evil.php', contentType: 'image/png' }).attach('images', PNG_1PX, { filename: 'b.png', contentType: 'image/png' });
    assert.equal(res.status, 201);
    assert.equal(res.body.type, 'photo');
    assert.equal(res.body.media.length, 2);
    for (const m of res.body.media) {
      assert.match(m.url, /\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{32}\.png$/);
      const served = await t.request.get(m.url);
      assert.equal(served.status, 200);
      assert.equal(served.headers['x-content-type-options'], 'nosniff');
      assert.match(served.headers['content-security-policy'], /sandbox/);
    }
  });

  test('uploads are verified by content, not by the declared type', async () => {
    const fakeImage = await alice.api.raw('post', '/api/posts').field('text', 'x').attach('images', Buffer.from('<?php system($_GET["c"]); ?>'), { filename: 'shell.png', contentType: 'image/png' });
    assert.equal(fakeImage.status, 400);
    const svg = await alice.api.raw('post', '/api/posts').field('text', 'x').attach('images', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { filename: 'a.svg', contentType: 'image/svg+xml' });
    assert.equal(svg.status, 400);
    const big = await alice.api.raw('post', '/api/posts').field('text', 'x').attach('images', Buffer.concat([PNG_1PX, Buffer.alloc(6 * 1024 * 1024)]), { filename: 'big.png', contentType: 'image/png' });
    assert.equal(big.status, 400);
    const files = fs.readdirSync(t.uploadDir, { recursive: true }).filter((f) => /\.(php|svg)$/.test(String(f)));
    assert.equal(files.length, 0, 'rejected files never reach disk');
  });

  test('polls: validation, voting, changing a vote, multi-choice and live results', async () => {
    assert.equal((await alice.api.post('/api/posts', { text: 'bad', poll: { question: 'q', options: ['only one'] } })).status, 400);
    const res = await alice.api.post('/api/posts', { text: 'Tabs or spaces?', audience: 'public', poll: { question: 'Tabs or spaces?', options: ['Tabs', 'Spaces', 'Both'], durationHours: 2 } });
    assert.equal(res.status, 201);
    assert.equal(res.body.type, 'poll');
    const [tabs, spaces] = res.body.poll.options;

    const v1 = await bob.api.post(`/api/posts/${res.body._id}/vote`, { options: [tabs._id] });
    assert.equal(v1.status, 200);
    assert.equal(v1.body.poll.totalVotes, 1);
    assert.deepEqual(v1.body.poll.myVote, [tabs._id]);

    const v2 = await bob.api.post(`/api/posts/${res.body._id}/vote`, { options: [spaces._id] });
    assert.equal(v2.body.poll.totalVotes, 1, 'changing a vote does not add another');
    const counts = Object.fromEntries(v2.body.poll.options.map((o) => [o.text, o.count]));
    assert.deepEqual(counts, { Tabs: 0, Spaces: 1, Both: 0 });

    assert.equal((await bob.api.post(`/api/posts/${res.body._id}/vote`, { options: [tabs._id, spaces._id] })).status, 400, 'single-choice');
    assert.equal((await bob.api.post(`/api/posts/${res.body._id}/vote`, { options: ['a'.repeat(24)] })).status, 400, 'unknown option');
    const seen = await alice.api.get(`/api/posts/${res.body._id}`);
    assert.deepEqual(seen.body.poll.myVote, []);
  });

  test('ended polls reject votes', async () => {
    const res = await alice.api.post('/api/posts', { text: 'old', audience: 'public', poll: { question: 'q?', options: ['a', 'b'], durationHours: 1 } });
    await t.mongoose.connection.collection('posts').updateOne({ _id: new t.mongoose.Types.ObjectId(res.body._id) }, { $set: { 'poll.endsAt': new Date(Date.now() - 1000) } });
    assert.equal((await bob.api.post(`/api/posts/${res.body._id}/vote`, { options: [res.body.poll.options[0]._id] })).status, 400);
  });
});

describe('editing, pinning, sharing, saving, hiding', () => {
  test('editing updates text, hashtags and editedAt, and keeps hashtag counters honest', async () => {
    const a = uniq('old'); const b = uniq('new');
    const post = await makePost(alice, { text: `first #${a}` });
    const edited = await alice.api.patch(`/api/posts/${post._id}`, { text: `second #${b}`, audience: 'friends' });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.hashtags, [b]);
    assert.ok(edited.body.editedAt);
    assert.equal(edited.body.audience, 'friends');
    assert.equal((await alice.api.patch(`/api/posts/${post._id}`, {})).status, 400);
    const tags = (await alice.api.get('/api/search/trending')).body.items.map((h) => h.tag);
    assert.ok(tags.includes(b));
    assert.ok(!tags.includes(a), 'removed hashtag no longer counts');
  });

  test('pinned post leads the profile and only one can be pinned', async () => {
    const u = await makeUser();
    const first = await makePost(u, { text: 'first' });
    const second = await makePost(u, { text: 'second' });
    const third = await makePost(u, { text: 'third' });
    await u.api.put(`/api/posts/${first._id}/pin`, { pinned: true });
    await u.api.put(`/api/posts/${second._id}/pin`, { pinned: true });
    const items = (await bob.api.get(`/api/posts/user/${u._id}`)).body.items;
    assert.equal(items[0]._id, second._id);
    assert.equal(items.filter((p) => p.pinned).length, 1);
    assert.deepEqual(items.map((p) => p._id).sort(), [first._id, second._id, third._id].sort());
  });

  test('sharing a public post creates a share, bumps the counter, and nests only one level', async () => {
    const original = await makePost(alice, { text: 'worth sharing' });
    const share = await bob.api.post(`/api/posts/${original._id}/share`, { text: 'agree!', audience: 'public' });
    assert.equal(share.status, 201);
    assert.equal(share.body.type, 'share');
    assert.equal(share.body.sharedPost.text, 'worth sharing');
    const reshare = await alice.api.post(`/api/posts/${share.body._id}/share`, { text: 'meta', audience: 'public' });
    assert.equal(reshare.body.sharedPost._id, original._id, 'a share of a share points at the original');
    assert.equal((await alice.api.get(`/api/posts/${original._id}`)).body.shareCount, 2);
    assert.ok((await alice.api.get('/api/notifications')).body.items.some((n) => n.type === 'share'));
  });

  test('only public posts can be shared', async () => {
    const priv = await makePost(alice, { text: 'friends only', audience: 'friends' });
    assert.equal((await bob.api.post(`/api/posts/${priv._id}/share`, { audience: 'public' })).status, 403);
  });

  test('saving, listing collections and unsaving', async () => {
    const post = await makePost(alice, { text: 'save me' });
    assert.equal((await bob.api.put(`/api/posts/${post._id}/save`, { collection: 'Reading' })).status, 200);
    assert.equal((await bob.api.get(`/api/posts/${post._id}`)).body.saved, true);
    const saved = await bob.api.get('/api/saved');
    assert.ok(saved.body.items.some((p) => p._id === post._id));
    assert.deepEqual((await bob.api.get('/api/saved/collections')).body.items, ['Reading']);
    assert.equal((await bob.api.get('/api/saved?collection=Other')).body.items.length, 0);
    await bob.api.delete(`/api/posts/${post._id}/save`);
    assert.equal((await bob.api.get('/api/saved')).body.items.length, 0);
  });

  test('hiding removes a post from your feed only; snoozing mutes the author', async () => {
    const u = await makeUser();
    const v = await makeUser();
    await befriend(u, v);
    const post = await makePost(u, { text: 'hide me', audience: 'friends' });
    assert.ok((await v.api.get('/api/posts/feed')).body.items.some((p) => p._id === post._id));
    await v.api.post(`/api/posts/${post._id}/hide`);
    assert.ok(!(await v.api.get('/api/posts/feed')).body.items.some((p) => p._id === post._id));
    assert.equal((await u.api.get(`/api/posts/${post._id}`)).status, 200);

    const second = await makePost(u, { text: 'second', audience: 'friends' });
    assert.ok((await v.api.get('/api/posts/feed')).body.items.some((p) => p._id === second._id));
    assert.equal((await v.api.post(`/api/posts/${second._id}/snooze`, { days: 7 })).status, 200);
    assert.equal((await v.api.get('/api/posts/feed')).body.items.length, 0, 'snoozed author disappears');
  });

  test('deleting a post cascades to its comments, reactions, saves, files and notifications', async () => {
    const res = await alice.api.raw('post', '/api/posts').field('text', 'doomed #cascade').field('audience', 'public').attach('images', PNG_1PX, { filename: 'a.png', contentType: 'image/png' });
    const post = res.body;
    const file = path.join(t.uploadDir, post.media[0].url.split('/uploads/')[1]);
    assert.ok(fs.existsSync(file));
    await bob.api.post(`/api/comments/post/${post._id}`, { text: 'nice' });
    await bob.api.put('/api/reactions', { targetType: 'post', target: post._id, type: 'love' });
    await bob.api.put(`/api/posts/${post._id}/save`, {});

    assert.equal((await alice.api.delete(`/api/posts/${post._id}`)).status, 200);
    const db = t.mongoose.connection;
    const id = new t.mongoose.Types.ObjectId(post._id);
    assert.equal(await db.collection('comments').countDocuments({ post: id }), 0);
    assert.equal(await db.collection('reactions').countDocuments({ target: id }), 0);
    assert.equal(await db.collection('saveditems').countDocuments({ post: id }), 0);
    assert.equal(await db.collection('notifications').countDocuments({ post: id }), 0);
    assert.equal(fs.existsSync(file), false);
    assert.equal((await bob.api.get(`/api/posts/${post._id}`)).status, 404);
  });
});

describe('feeds and pagination', () => {
  test('the feed contains you, friends and people you follow - not strangers - newest first', async () => {
    const me = await makeUser();
    const friend = await makeUser();
    const followed = await makeUser();
    const stranger = await makeUser();
    await befriend(me, friend);
    await me.api.post(`/api/follow/${followed._id}`);
    const mine = await makePost(me, { text: 'mine' });
    const f = await makePost(friend, { text: 'friend', audience: 'friends' });
    const fo = await makePost(followed, { text: 'followed' });
    const s = await makePost(stranger, { text: 'stranger' });
    const ids = (await me.api.get('/api/posts/feed')).body.items.map((p) => p._id);
    assert.deepEqual(ids, [fo._id, f._id, mine._id]);
    assert.ok(!ids.includes(s._id));
  });

  test('cursor pagination walks every post exactly once, with no overlap', async () => {
    const author = await makeUser();
    const created = [];
    for (let i = 0; i < 23; i++) created.push((await makePost(author, { text: `post ${i}` }))._id);

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await author.api.get(`/api/posts/feed?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.items.length <= 10);
      seen.push(...res.body.items.map((p) => p._id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    assert.equal(pages, 3);
    assert.deepEqual(seen, [...created].reverse());
    assert.equal(new Set(seen).size, 23);
    assert.equal((await author.api.get('/api/posts/feed?cursor=garbage')).status, 400);
    assert.equal((await author.api.get('/api/posts/feed?limit=500')).status, 400, 'page size is capped');
  });

  test('explore only returns public posts; trending ranks engagement', async () => {
    const author = await makeUser();
    const viewer = await makeUser();
    const quiet = await makePost(author, { text: 'quiet trending-test' });
    const hot = await makePost(author, { text: 'hot trending-test' });
    await makePost(author, { text: 'friends only', audience: 'friends' });
    await author.api.put('/api/reactions', { targetType: 'post', target: hot._id, type: 'love' });
    await viewer.api.put('/api/reactions', { targetType: 'post', target: hot._id, type: 'wow' });
    await viewer.api.post(`/api/comments/post/${hot._id}`, { text: 'wow' });

    const explore = (await viewer.api.get('/api/posts/explore?limit=30')).body.items;
    assert.ok(explore.every((p) => p.audience === 'public'));
    const trending = (await viewer.api.get('/api/posts/trending?limit=30')).body.items.map((p) => p._id);
    assert.ok(trending.indexOf(hot._id) < trending.indexOf(quiet._id), 'engaged post ranks above the quiet one');
  });

  test('profile post lists support photo and tagged tabs', async () => {
    const u = await makeUser();
    const friend = await makeUser();
    await befriend(u, friend);
    await u.api.raw('post', '/api/posts').field('text', 'pic').field('audience', 'public').attach('images', PNG_1PX, { filename: 'a.png', contentType: 'image/png' });
    await makePost(u, { text: 'no pic' });
    const tagged = await friend.api.post('/api/posts', { text: 'with u', audience: 'public', tags: [u._id] });
    assert.equal(tagged.status, 201);
    assert.equal((await friend.api.get(`/api/posts/user/${u._id}?kind=photos`)).body.items.length, 1);
    const tags = (await friend.api.get(`/api/posts/user/${u._id}?kind=tagged`)).body.items;
    assert.equal(tags.length, 1);
    assert.equal(tags[0]._id, tagged.body._id);
    assert.ok((await u.api.get('/api/notifications')).body.items.some((n) => n.type === 'tag'));
  });
});
