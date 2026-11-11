// Shared test harness. Each test file runs in its own process (node --test), so each gets its own
// database and upload directory. Point TEST_MONGO_URI at any MongoDB-compatible server.
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let ctx;

export async function setup() {
  if (ctx) return ctx;
  const dbName = `circle_test_${crypto.randomBytes(4).toString('hex')}`;
  const base = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = `${base.replace(/\/$/, '')}/${dbName}`;
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'circle-uploads-'));
  process.env.RATE_LIMIT_DISABLED = 'true';

  const [{ connectDb, disconnectDb }, { createApp }, mongoose, mail, { cache }, { default: supertest }] = await Promise.all([
    import('../src/config/db.js'),
    import('../src/app.js'),
    import('mongoose'),
    import('../src/services/mailService.js'),
    import('../src/config/cache.js'),
    import('supertest'),
  ]);
  await connectDb();
  await Promise.all(Object.values(mongoose.default.models).map((m) => m.init()));
  const app = createApp();
  ctx = { app, request: supertest(app), mongoose: mongoose.default, mail, cache, disconnectDb, uploadDir: process.env.UPLOAD_DIR, dbName };
  return ctx;
}

export async function teardown() {
  if (!ctx) return;
  await ctx.mongoose.connection.dropDatabase().catch(() => {});
  await ctx.disconnectDb();
  await ctx.cache.close();
  fs.rmSync(ctx.uploadDir, { recursive: true, force: true });
  ctx = null;
}

let counter = 0;
export const uniq = (p = 'user') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`.toLowerCase().slice(0, 28);

export const PASSWORD = 'Sup3rSecret!';

// Wraps supertest so every call carries the bearer token.
export function client(request, token) {
  const withAuth = (r) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    token,
    get: (url) => withAuth(request.get(url)),
    post: (url, body) => withAuth(request.post(url)).send(body),
    put: (url, body) => withAuth(request.put(url)).send(body),
    patch: (url, body) => withAuth(request.patch(url)).send(body),
    delete: (url, body) => withAuth(request.delete(url)).send(body),
    raw: (method, url) => withAuth(request[method](url)),
  };
}

export async function makeUser(overrides = {}) {
  const { request, mail } = ctx;
  const username = overrides.username || uniq('u');
  const email = overrides.email || `${username}@example.test`;
  const password = overrides.password || PASSWORD;

  const reg = await request.post('/api/auth/register').send({ username, email, password, name: overrides.name || `Test ${username}` });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const link = mail.lastMailTo(email).text.match(/token=([a-f0-9]+)/)[1];
  const ver = await request.post('/api/auth/verify-email').send({ token: link });
  if (ver.status !== 200) throw new Error(`verify failed: ${ver.status}`);

  const login = await request.post('/api/auth/login').send({ identifier: email, password }).set('User-Agent', overrides.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0');
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);

  const user = { ...login.body.user, username, email, password, token: login.body.accessToken, cookies: login.headers['set-cookie'] };
  user.api = client(request, user.token);
  return user;
}

export const cookieValue = (setCookie, name) => {
  const line = (setCookie || []).find((c) => c.startsWith(`${name}=`));
  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

export async function befriend(a, b) {
  const sent = await a.api.post(`/api/friends/requests/${b._id}`);
  if (sent.status !== 201) throw new Error(`friend request failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  if (sent.body.status === 'friends') return;
  const accepted = await b.api.post(`/api/friends/requests/${sent.body.requestId}/accept`);
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status}`);
}

export const makePost = async (user, body = {}) => {
  const res = await user.api.post('/api/posts', { text: 'hello world', audience: 'public', ...body });
  if (res.status !== 201) throw new Error(`post failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

// smallest valid PNG (1x1)
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export const refreshWith = (request, setCookie) => {
  const rt = cookieValue(setCookie, 'rt');
  const csrf = cookieValue(setCookie, 'csrf');
  return request.post('/api/auth/refresh').set('Cookie', [`rt=${rt}`, `csrf=${csrf}`]).set('X-CSRF-Token', csrf);
};
