import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, makeUser, makePost, uniq, client, cookieValue, refreshWith, PASSWORD } from './helpers.js';
import { totpAt } from '../src/utils/crypto.js';

let t;
before(async () => { t = await setup(); });
after(teardown);

const login = (identifier, password = PASSWORD, extra = {}) => t.request.post('/api/auth/login').send({ identifier, password, ...extra }).set('User-Agent', 'Mozilla/5.0 (Macintosh; Mac OS X) Safari/605');

describe('registration and email verification', () => {
  test('rejects weak passwords, bad usernames and bad emails', async () => {
    const base = { username: uniq(), email: `${uniq()}@x.test`, password: PASSWORD };
    assert.equal((await t.request.post('/api/auth/register').send({ ...base, password: 'short' })).status, 400);
    assert.equal((await t.request.post('/api/auth/register').send({ ...base, password: 'onlyletters' })).status, 400);
    assert.equal((await t.request.post('/api/auth/register').send({ ...base, username: 'bad name!' })).status, 400);
    assert.equal((await t.request.post('/api/auth/register').send({ ...base, email: 'nope' })).status, 400);
  });

  test('cannot sign in until the email is verified; the link works once', async () => {
    const username = uniq();
    const email = `${username}@x.test`;
    const reg = await t.request.post('/api/auth/register').send({ username, email, password: PASSWORD });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.password, undefined);

    const blocked = await login(email);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'EMAIL_NOT_VERIFIED');

    const token = t.mail.lastMailTo(email).text.match(/token=([a-f0-9]+)/)[1];
    assert.equal((await t.request.post('/api/auth/verify-email').send({ token })).status, 200);
    assert.equal((await t.request.post('/api/auth/verify-email').send({ token })).status, 400, 'token must be single-use');
    assert.equal((await login(email)).status, 200);
  });

  test('duplicate username or email is rejected', async () => {
    const u = await makeUser();
    const dupName = await t.request.post('/api/auth/register').send({ username: u.username, email: `${uniq()}@x.test`, password: PASSWORD });
    const dupEmail = await t.request.post('/api/auth/register').send({ username: uniq(), email: u.email, password: PASSWORD });
    assert.equal(dupName.status, 409);
    assert.equal(dupEmail.status, 409);
  });

  test('passwords are stored hashed and never returned', async () => {
    const u = await makeUser();
    const row = await t.mongoose.connection.collection('users').findOne({ username: u.username });
    assert.match(row.passwordHash, /^\$2[aby]\$/);
    assert.notEqual(row.passwordHash, PASSWORD);
    const me = await u.api.get('/api/auth/me');
    assert.equal(JSON.stringify(me.body).includes('passwordHash'), false);
  });
});

describe('login, cookies and tokens', () => {
  test('login sets an httpOnly strict refresh cookie and returns a short-lived access token', async () => {
    const u = await makeUser();
    const res = await login(u.email, PASSWORD, { remember: true });
    const rt = res.headers['set-cookie'].find((c) => c.startsWith('rt='));
    assert.match(rt, /HttpOnly/i);
    assert.match(rt, /SameSite=Strict/i);
    assert.match(rt, /Path=\/api\/auth/);
    const csrf = res.headers['set-cookie'].find((c) => c.startsWith('csrf='));
    assert.doesNotMatch(csrf, /HttpOnly/i, 'csrf cookie must be readable by JS for double-submit');
    assert.ok(res.body.accessToken.split('.').length === 3);
    assert.equal(res.body.refreshToken, undefined, 'refresh token must never be in the body');
  });

  test('login works with username too, and errors never reveal which part was wrong', async () => {
    const u = await makeUser();
    assert.equal((await login(u.username)).status, 200);
    const wrongPw = await login(u.email, 'WrongPass123');
    const unknown = await login('nobody-here@x.test', 'WrongPass123');
    assert.equal(wrongPw.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrongPw.body.message, unknown.body.message);
  });

  test('protected routes require a valid bearer token', async () => {
    assert.equal((await t.request.get('/api/auth/me')).status, 401);
    assert.equal((await t.request.get('/api/auth/me').set('Authorization', 'Bearer garbage')).status, 401);
    const u = await makeUser();
    assert.equal((await u.api.get('/api/auth/me')).status, 200);
  });

  test('a tampered token is rejected', async () => {
    const u = await makeUser();
    const [h, p, s] = u.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), role: 'admin' })).toString('base64url');
    const res = await t.request.get('/api/auth/me').set('Authorization', `Bearer ${h}.${forged}.${s}`);
    assert.equal(res.status, 401);
  });
});

describe('brute-force protection', () => {
  test('the account locks after repeated failures, even for the right password', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) assert.equal((await login(u.email, 'WrongPass123')).status, 401);
    const locked = await login(u.email, PASSWORD);
    assert.equal(locked.status, 429);
    assert.equal(locked.body.code, 'ACCOUNT_LOCKED');
  });
});

describe('refresh tokens', () => {
  test('refresh requires the CSRF header', async () => {
    const u = await makeUser();
    const rt = cookieValue(u.cookies, 'rt');
    const csrf = cookieValue(u.cookies, 'csrf');
    assert.equal((await t.request.post('/api/auth/refresh').set('Cookie', [`rt=${rt}`, `csrf=${csrf}`])).status, 403);
    assert.equal((await t.request.post('/api/auth/refresh').set('Cookie', [`rt=${rt}`, `csrf=${csrf}`]).set('X-CSRF-Token', 'wrong')).status, 403);
    assert.equal((await refreshWith(t.request, u.cookies)).status, 200);
  });

  test('refresh rotates the token; replaying the old one revokes the whole session family', async () => {
    const u = await makeUser();
    const first = await refreshWith(t.request, u.cookies);
    assert.equal(first.status, 200);
    assert.notEqual(cookieValue(first.headers['set-cookie'], 'rt'), cookieValue(u.cookies, 'rt'));
    assert.equal((await client(t.request, first.body.accessToken).get('/api/auth/me')).status, 200);

    const replay = await refreshWith(t.request, u.cookies); // the original, already-used token
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'TOKEN_REUSE');

    // the legitimately rotated token (and its access token) must now be dead too
    assert.equal((await refreshWith(t.request, first.headers['set-cookie'])).status, 401);
    assert.equal((await client(t.request, first.body.accessToken).get('/api/auth/me')).status, 401);
  });

  test('logout ends the session immediately', async () => {
    const u = await makeUser();
    const rt = cookieValue(u.cookies, 'rt');
    const csrf = cookieValue(u.cookies, 'csrf');
    const out = await t.request.post('/api/auth/logout').set('Cookie', [`rt=${rt}`, `csrf=${csrf}`]).set('X-CSRF-Token', csrf);
    assert.equal(out.status, 200);
    const after = await u.api.get('/api/auth/me');
    assert.equal(after.status, 401);
    assert.equal(after.body.code, 'SESSION_REVOKED');
    assert.equal((await refreshWith(t.request, u.cookies)).status, 401);
  });
});

describe('sessions, devices and login history', () => {
  test('lists devices, revokes one, and records login history', async () => {
    const u = await makeUser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537' });
    const second = await login(u.email);
    const other = client(t.request, second.body.accessToken);

    const list = await u.api.get('/api/auth/sessions');
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);
    assert.equal(list.body.items.filter((s) => s.current).length, 1);

    const target = (await other.get('/api/auth/sessions')).body.items.find((s) => !s.current);
    assert.equal((await other.delete(`/api/auth/sessions/${target.family}`)).status, 200);
    assert.equal((await u.api.get('/api/auth/me')).status, 401, 'the revoked device is signed out');
    assert.equal((await other.get('/api/auth/me')).status, 200);

    const history = await other.get('/api/auth/login-history');
    assert.ok(history.body.items.length >= 2);
    assert.ok(history.body.items.every((e) => e.success === true || e.success === false));
  });

  test('cannot revoke someone else\'s session', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const fam = (await a.api.get('/api/auth/sessions')).body.items[0].family;
    assert.equal((await b.api.delete(`/api/auth/sessions/${fam}`)).status, 404);
    assert.equal((await a.api.get('/api/auth/me')).status, 200);
  });

  test('a sign-in from a new device sends a security alert email', async () => {
    const u = await makeUser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537' });
    const before = t.mail.outbox.length;
    await t.request.post('/api/auth/login').send({ identifier: u.email, password: PASSWORD }).set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604');
    const alert = t.mail.outbox.slice(before).find((m) => m.to === u.email && /new sign-in/i.test(m.subject));
    assert.ok(alert, 'expected a new-device alert');
  });
});

describe('passwords', () => {
  test('change password verifies the current one and signs out other devices', async () => {
    const u = await makeUser();
    const second = client(t.request, (await login(u.email)).body.accessToken);
    assert.equal((await u.api.post('/api/auth/change-password', { currentPassword: 'Wrong12345', newPassword: 'Brand-new-9' })).status, 403);
    assert.equal((await u.api.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Brand-new-9' })).status, 200);
    assert.equal((await second.get('/api/auth/me')).status, 401);
    assert.equal((await u.api.get('/api/auth/me')).status, 200, 'the device that changed it stays signed in');
    assert.equal((await login(u.email, PASSWORD)).status, 401);
    assert.equal((await login(u.email, 'Brand-new-9')).status, 200);
  });

  test('forgot and reset password: generic response, single-use token, sessions revoked', async () => {
    const u = await makeUser();
    const unknown = await t.request.post('/api/auth/forgot-password').send({ email: 'ghost@x.test' });
    const known = await t.request.post('/api/auth/forgot-password').send({ email: u.email });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, known.body, 'must not reveal whether the account exists');

    const token = t.mail.lastMailTo(u.email).text.match(/token=([a-f0-9]+)/)[1];
    assert.equal((await t.request.post('/api/auth/reset-password').send({ token, newPassword: 'weak' })).status, 400);
    assert.equal((await t.request.post('/api/auth/reset-password').send({ token, newPassword: 'Another-pass-7' })).status, 200);
    assert.equal((await t.request.post('/api/auth/reset-password').send({ token, newPassword: 'Another-pass-8' })).status, 400);
    assert.equal((await u.api.get('/api/auth/me')).status, 401);
    assert.equal((await login(u.email, 'Another-pass-7')).status, 200);
  });
});

describe('two-factor authentication', () => {
  test('setup, enable, required at login, recovery codes work once', async () => {
    const u = await makeUser();
    const setup = await u.api.post('/api/auth/2fa/setup');
    assert.equal(setup.status, 200);
    assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\//);

    assert.equal((await u.api.post('/api/auth/2fa/enable', { code: '000000' })).status, 400);
    const enable = await u.api.post('/api/auth/2fa/enable', { code: totpAt(setup.body.secret) });
    assert.equal(enable.status, 200);
    assert.equal(enable.body.recoveryCodes.length, 8);

    const challenge = await login(u.email);
    assert.equal(challenge.status, 200);
    assert.equal(challenge.body.twoFactorRequired, true);
    assert.equal(challenge.body.accessToken, undefined);

    assert.equal((await login(u.email, PASSWORD, { otp: '123456' })).status, 401);
    assert.equal((await login(u.email, PASSWORD, { otp: totpAt(setup.body.secret) })).status, 200);

    const code = enable.body.recoveryCodes[0];
    assert.equal((await login(u.email, PASSWORD, { otp: code })).status, 200);
    assert.equal((await login(u.email, PASSWORD, { otp: code })).status, 401, 'recovery codes are single-use');

    const disable = await u.api.post('/api/auth/2fa/disable', { password: PASSWORD, code: totpAt(setup.body.secret) });
    assert.equal(disable.status, 200);
    assert.equal((await login(u.email)).body.accessToken !== undefined, true);
  });
});

describe('account lifecycle', () => {
  test('deactivation hides the account and its posts; signing in reactivates it', async () => {
    const u = await makeUser();
    const viewer = await makeUser();
    const post = await makePost(u, { text: 'visible while active' });
    assert.equal((await viewer.api.get(`/api/posts/${post._id}`)).status, 200);

    assert.equal((await u.api.post('/api/auth/deactivate', { password: 'Wrong12345' })).status, 403);
    assert.equal((await u.api.post('/api/auth/deactivate', { password: PASSWORD })).status, 200);
    assert.equal((await u.api.get('/api/auth/me')).status, 401);
    assert.equal((await viewer.api.get(`/api/posts/${post._id}`)).status, 404);
    assert.equal((await viewer.api.get(`/api/profiles/${u.username}`)).status, 404);

    assert.equal((await login(u.email)).status, 200);
    assert.equal((await viewer.api.get(`/api/posts/${post._id}`)).status, 200);
  });

  test('deleting the account removes the user and everything they created', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const mine = await makePost(u, { text: 'goodbye' });
    const theirs = await makePost(other, { text: 'stays' });
    await u.api.post(`/api/comments/post/${theirs._id}`, { text: 'my comment' });
    await u.api.put('/api/reactions', { targetType: 'post', target: theirs._id, type: 'love' });
    await other.api.put('/api/reactions', { targetType: 'post', target: mine._id, type: 'like' });

    assert.equal((await u.api.delete('/api/auth/account', { password: 'nope' })).status, 403);
    const del = await u.api.delete('/api/auth/account', { password: PASSWORD });
    assert.equal(del.status, 200);

    const db = t.mongoose.connection;
    assert.equal(await db.collection('users').countDocuments({ username: u.username }), 0);
    assert.equal(await db.collection('posts').countDocuments({ author: new t.mongoose.Types.ObjectId(u._id) }), 0);
    assert.equal(await db.collection('comments').countDocuments({ author: new t.mongoose.Types.ObjectId(u._id) }), 0);

    const after = (await other.api.get(`/api/posts/${theirs._id}`)).body;
    assert.equal(after.commentCount, 0, 'counters on other people\'s posts are corrected');
    assert.equal(after.reactionTotal, 0);
    assert.equal((await t.request.post('/api/auth/login').send({ identifier: u.email, password: PASSWORD })).status, 401);
  });
});
