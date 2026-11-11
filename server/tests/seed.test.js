import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { setup, teardown, client } from './helpers.js';

let t;
let seedDemo;
const quiet = () => {};
before(async () => {
  t = await setup();
  ({ seedDemo } = await import('../src/seeds/seed.js'));
});
after(teardown);

const login = (identifier) => t.request.post('/api/auth/login').send({ identifier, password: 'Password123!' });

describe('demo seed', () => {
  test('fills an empty database with a realistic network', async () => {
    const res = await seedDemo({ log: quiet });
    assert.equal(res.seeded, true);
    const count = (c) => t.mongoose.connection.collection(c).countDocuments();
    assert.ok((await count('users')) >= 30, 'at least 30 users');
    assert.ok((await count('posts')) >= 100, 'at least 100 posts');
    assert.ok((await count('comments')) > 100);
    assert.ok((await count('friendships')) > 100);
    assert.ok((await count('reactions')) > 100);
    assert.ok((await count('posts')) > 0 && (await t.mongoose.connection.collection('posts').countDocuments({ type: 'poll' })) >= 1, 'has polls');
    assert.ok(fs.existsSync(path.join(t.uploadDir, 'seed')), 'seed images written to the upload dir');
  });

  test('demo, admin and moderator accounts can sign in with the documented password', async () => {
    for (const [email, role] of [['demo@circle.test', 'user'], ['admin@circle.test', 'admin'], ['moderator@circle.test', 'moderator']]) {
      const res = await login(email);
      assert.equal(res.status, 200, `${email} -> ${res.status}`);
      assert.equal(res.body.user.role, role);
    }
  });

  test('the seeded data reads correctly through the real API', async () => {
    const me = client(t.request, (await login('demo@circle.test')).body.accessToken);
    const feed = await me.get('/api/posts/feed?limit=10');
    assert.equal(feed.status, 200);
    assert.ok(feed.body.items.length >= 5, 'demo user has a populated feed');
    assert.ok(feed.body.items.every((p) => p.author?.username && p.reactionCounts), 'posts are fully presented');
    const requests = await me.get('/api/friends/requests');
    assert.ok(requests.body.items.length >= 1, 'demo user has pending friend requests');
    const notes = await me.get('/api/notifications');
    assert.ok(notes.body.items.length >= 1);
    const poll = (await me.get('/api/posts/explore?limit=30')).body.items.find((p) => p.type === 'poll');
    assert.ok(poll?.poll.options.length >= 2, 'polls have options');
    const stats = await client(t.request, (await login('admin@circle.test')).body.accessToken).get('/api/admin/stats');
    assert.equal(stats.status, 200);
  });

  test('running it again does nothing, and reset rebuilds from scratch', async () => {
    const before = await t.mongoose.connection.collection('users').countDocuments();
    assert.equal((await seedDemo({ log: quiet })).seeded, false);
    assert.equal(await t.mongoose.connection.collection('users').countDocuments(), before);
    assert.equal((await seedDemo({ reset: true, log: quiet })).seeded, true);
    assert.equal(await t.mongoose.connection.collection('users').countDocuments(), before);
    assert.equal((await login('demo@circle.test')).status, 200);
  });

  test('refuses to run against production unless forced', async () => {
    const { env } = await import('../src/config/env.js');
    env.isProd = true;
    try {
      await assert.rejects(() => seedDemo({ log: quiet }), /production/i);
      assert.equal((await seedDemo({ force: true, log: quiet })).seeded, false);
    } finally {
      env.isProd = false;
    }
  });
});

describe('seeded messages', () => {
  test('demo user has conversations, an unread badge and readable threads', async () => {
    const { request } = t;
    const login = await request.post('/api/auth/login').send({ identifier: 'demo@circle.test', password: 'Password123!' });
    const api = client(request, login.body.accessToken);
    const convs = (await api.get('/api/messages/conversations')).body.items;
    assert.ok(convs.length >= 3, 'several chats seeded');
    assert.ok((await api.get('/api/messages/unread-count')).body.unread >= 1);
    const thread = (await api.get(`/api/messages/conversations/${convs[0]._id}/messages`)).body.items;
    assert.ok(thread.length >= 2);
    assert.ok(thread[0].createdAt >= thread[thread.length - 1].createdAt, 'newest first');
  });
});
