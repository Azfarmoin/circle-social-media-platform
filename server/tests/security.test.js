import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, makeUser, makePost, uniq, PASSWORD } from './helpers.js';

let t;
let alice; let bob;
before(async () => {
  t = await setup();
  [alice, bob] = await Promise.all([makeUser(), makeUser()]);
});
after(teardown);

describe('NoSQL injection', () => {
  test('operator objects in login fields are rejected, not evaluated', async () => {
    const attempts = [
      { identifier: { $ne: null }, password: { $ne: null } },
      { identifier: alice.email, password: { $gt: '' } },
      { identifier: { $regex: '.*' }, password: PASSWORD },
    ];
    for (const body of attempts) {
      const res = await t.request.post('/api/auth/login').send(body);
      assert.ok([400, 401].includes(res.status), `status ${res.status} for ${JSON.stringify(body)}`);
      assert.equal(res.body.accessToken, undefined);
    }
  });

  test('operators in query strings and params cannot widen a query', async () => {
    const res = await alice.api.get('/api/search/people?q[$ne]=x');
    assert.ok([200, 400].includes(res.status));
    if (res.status === 200) assert.equal(res.body.items.length, 0);
    assert.equal((await alice.api.get('/api/posts/feed?cursor[$gt]=')).status, 400);
    assert.equal((await alice.api.get('/api/posts/%7B%22$ne%22:1%7D')).status, 400);
    const forgot = await t.request.post('/api/auth/forgot-password').send({ email: { $ne: '' } });
    assert.equal(forgot.status, 400, 'email must be a string');
  });

  test('operators smuggled into a post body are neutralised', async () => {
    const res = await alice.api.post('/api/posts', { text: 'ok', audience: { $ne: 'public' } });
    assert.equal(res.status, 400);
    const prof = await alice.api.put('/api/profiles/me', { bio: { $set: { role: 'admin' } } });
    assert.equal(prof.status, 400);
    const me = (await alice.api.get('/api/auth/me')).body.user;
    assert.equal(me.role, 'user');
  });
});

describe('mass assignment', () => {
  test('registration ignores role, status and verification flags', async () => {
    const username = uniq('mass');
    const email = `${username}@x.test`;
    const res = await t.request.post('/api/auth/register').send({ username, email, password: PASSWORD, role: 'admin', emailVerified: true, status: 'active', verifiedBadge: true });
    assert.equal(res.status, 201);
    const row = await t.mongoose.connection.collection('users').findOne({ username });
    assert.equal(row.role, 'user');
    assert.equal(row.emailVerified, false);
    assert.equal(row.verifiedBadge, false);
  });

  test('profile updates cannot touch protected fields', async () => {
    const res = await alice.api.put('/api/profiles/me', { name: 'Alice', role: 'admin', verifiedBadge: true, friendCount: 999, email: 'evil@x.test' });
    assert.equal(res.status, 200);
    const row = await t.mongoose.connection.collection('users').findOne({ username: alice.username });
    assert.equal(row.role, 'user');
    assert.equal(row.verifiedBadge, false);
    assert.equal(row.friendCount, 0);
    assert.equal(row.email, alice.email);
    assert.equal(row.name, 'Alice');
  });

  test('post creation cannot set counters, author or authorActive', async () => {
    const res = await alice.api.post('/api/posts', { text: 'sneaky', audience: 'public', reactionTotal: 5000, commentCount: 99, author: bob._id, authorActive: false, pinned: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.reactionTotal, 0);
    assert.equal(res.body.commentCount, 0);
    assert.equal(res.body.author.username, alice.username);
    assert.equal(res.body.pinned, false);
  });
});

describe('XSS and content hygiene', () => {
  test('markup in posts, comments, bios and names is stripped before storage', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>hello <b onclick=x>there</b>';
    const post = await makePost(alice, { text: payload });
    assert.ok(!/[<>]/.test(post.text), post.text);
    assert.ok(post.text.includes('hello'));
    const c = await bob.api.post(`/api/comments/post/${post._id}`, { text: payload });
    assert.ok(!/[<>]/.test(c.body.comment.text));
    const prof = await alice.api.put('/api/profiles/me', { bio: payload, name: '<i>Ali</i>ce' });
    assert.equal(prof.status, 200);
    assert.ok(!/[<>]/.test(prof.body.user.bio));
    assert.equal(prof.body.user.name, 'Alice');
  });

  test('javascript: URLs are not accepted as a website', async () => {
    assert.equal((await alice.api.put('/api/profiles/me', { website: 'javascript:alert(1)' })).status, 400);
    assert.equal((await alice.api.put('/api/profiles/me', { website: 'https://example.com' })).status, 200);
  });

  test('uploaded files are served with nosniff and a sandboxing CSP', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const res = await alice.api.raw('post', '/api/profiles/me/avatar').attach('image', png, { filename: 'me.png', contentType: 'image/png' });
    assert.equal(res.status, 200);
    const file = await t.request.get(res.body.url);
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    assert.match(file.headers['content-security-policy'], /sandbox/);
  });

  test('path traversal through the uploads route is blocked', async () => {
    for (const p of ['/uploads/../.env', '/uploads/%2e%2e/package.json', '/uploads/..%2f..%2fetc/passwd']) {
      const res = await t.request.get(p);
      assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
    }
  });
});

describe('transport and headers', () => {
  test('security headers are set and the framework is not advertised', async () => {
    const res = await t.request.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-frame-options'] || /frame-ancestors/.test(res.headers['content-security-policy'] || ''));
    assert.ok(res.headers['strict-transport-security']);
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  });

  test('CORS only allows the configured client origin', async () => {
    const good = await t.request.options('/api/auth/login').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    assert.equal(good.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(good.headers['access-control-allow-credentials'], 'true');
    const bad = await t.request.options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    assert.notEqual(bad.headers['access-control-allow-origin'], 'https://evil.example');
  });

  test('malformed and oversized bodies get clean errors, not stack traces', async () => {
    const bad = await t.request.post('/api/auth/login').set('Content-Type', 'application/json').send('{"identifier": ');
    assert.equal(bad.status, 400);
    assert.ok(!/at .*\.js/.test(JSON.stringify(bad.body)), 'no stack traces');
    const big = await t.request.post('/api/auth/login').send({ identifier: 'a'.repeat(200000), password: 'x' });
    assert.equal(big.status, 413);
    assert.equal((await t.request.get('/api/definitely-not-a-route')).status, 401, 'unknown routes do not reveal themselves to anonymous callers');
    assert.equal((await alice.api.get('/api/definitely-not-a-route')).status, 404);
  });

  test('the refresh cookie cannot be used without the CSRF header, even from a forged cross-site request', async () => {
    const res = await t.request.post('/api/auth/logout').set('Cookie', alice.cookies.map((c) => c.split(';')[0]));
    assert.equal(res.status, 403);
    assert.equal((await alice.api.get('/api/auth/me')).status, 200, 'the session survived the forged logout');
  });
});

describe('abuse limits', () => {
  test('page sizes and list lengths are capped', async () => {
    assert.equal((await alice.api.get('/api/posts/feed?limit=1000')).status, 400);
    assert.equal((await alice.api.get('/api/friends?limit=0')).status, 400);
    const tooMany = Array.from({ length: 11 }, (_, i) => `opt${i}`);
    assert.equal((await alice.api.post('/api/posts', { text: 'x', poll: { question: 'q', options: tooMany } })).status, 400);
    assert.equal((await alice.api.post('/api/posts', { text: 'x'.repeat(6000) })).status, 400);
    assert.equal((await alice.api.post('/api/posts', { text: 'x', tags: Array.from({ length: 40 }, () => 'a'.repeat(24)) })).status, 400);
  });

  test('an api route with a bad id format is a 400, never a 500', async () => {
    for (const url of ['/api/posts/zzz', '/api/comments/zzz/replies', '/api/friends/mutual/1', '/api/profiles/%00']) {
      const res = await alice.api.get(url);
      assert.ok(res.status >= 400 && res.status < 500, `${url} -> ${res.status}`);
    }
  });
});
