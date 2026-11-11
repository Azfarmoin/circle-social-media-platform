import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, makeUser, befriend } from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(teardown);

const open = (u, other) => u.api.post('/api/messages/conversations', { userId: other._id });
const send = (u, convId, text) => u.api.post(`/api/messages/conversations/${convId}/messages`, { text });

describe('direct messages', () => {
  test('two people can chat: send, list, unread counts and read receipts', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const opened = await open(a, b);
    assert.equal(opened.status, 200);
    const id = opened.body._id;
    assert.equal(opened.body.other.username, b.username);
    assert.equal((await open(b, a)).body._id, id, 'both sides share one conversation');

    // empty conversations are not listed
    assert.equal((await a.api.get('/api/messages/conversations')).body.items.length, 0);

    assert.equal((await send(a, id, 'hello there')).status, 201);
    assert.equal((await send(a, id, '  second one  ')).body.text, 'second one');

    const list = (await b.api.get('/api/messages/conversations')).body.items;
    assert.equal(list.length, 1);
    assert.equal(list[0].unread, 2);
    assert.equal(list[0].lastMessage.text, 'second one');
    assert.equal((await b.api.get('/api/messages/unread-count')).body.unread, 2);
    assert.equal((await a.api.get('/api/messages/unread-count')).body.unread, 0);

    const thread = (await b.api.get(`/api/messages/conversations/${id}/messages`)).body;
    assert.deepEqual(thread.items.map((m) => m.text), ['second one', 'hello there'], 'newest first');
    assert.equal(thread.items[0].readAt, undefined, 'recipients do not see read state of incoming messages');

    assert.equal((await b.api.post(`/api/messages/conversations/${id}/read`)).status, 200);
    assert.equal((await b.api.get('/api/messages/unread-count')).body.unread, 0);
    const seen = (await a.api.get(`/api/messages/conversations/${id}/messages`)).body.items;
    assert.ok(seen.every((m) => m.readAt), 'sender sees both as read');
  });

  test('messages paginate by cursor', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = (await open(a, b)).body._id;
    for (let i = 1; i <= 5; i++) await send(a, id, `m${i}`);
    const p1 = (await a.api.get(`/api/messages/conversations/${id}/messages?limit=3`)).body;
    assert.deepEqual(p1.items.map((m) => m.text), ['m5', 'm4', 'm3']);
    const p2 = (await a.api.get(`/api/messages/conversations/${id}/messages?limit=3&cursor=${p1.nextCursor}`)).body;
    assert.deepEqual(p2.items.map((m) => m.text), ['m2', 'm1']);
    assert.equal(p2.nextCursor, null);
  });

  test('outsiders cannot read or write a conversation', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const id = (await open(a, b)).body._id;
    await send(a, id, 'private');
    assert.equal((await c.api.get(`/api/messages/conversations/${id}/messages`)).status, 404);
    assert.equal((await send(c, id, 'hi')).status, 404);
    assert.equal((await c.api.post(`/api/messages/conversations/${id}/read`)).status, 404);
    assert.equal((await t.request.get(`/api/messages/conversations`)).status, 401);
  });

  test('validation: empty and oversized messages, bad ids, messaging yourself', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = (await open(a, b)).body._id;
    assert.equal((await send(a, id, '   ')).status, 400);
    assert.equal((await send(a, id, 'x'.repeat(2001))).status, 400);
    assert.equal((await open(a, a)).status, 400);
    assert.equal((await a.api.post('/api/messages/conversations', { userId: 'nope' })).status, 400);
  });

  test('privacy: whoCanMessage and blocking are enforced', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await b.api.put('/api/profiles/me/privacy', { whoCanMessage: 'friends' });
    const denied = await open(a, b);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'MESSAGES_FRIENDS_ONLY');
    await befriend(a, b);
    const id = (await open(a, b)).body._id;
    assert.equal((await send(a, id, 'now friends')).status, 201);

    await b.api.put('/api/profiles/me/privacy', { whoCanMessage: 'nobody' });
    const off = await send(a, id, 'still there?');
    assert.equal(off.status, 403);
    assert.equal(off.body.code, 'MESSAGES_OFF');
    await b.api.put('/api/profiles/me/privacy', { whoCanMessage: 'everyone' });

    await b.api.post(`/api/users/${a._id}/block`, { type: 'block' });
    assert.equal((await send(a, id, 'blocked')).status, 404);
    assert.equal((await a.api.get('/api/messages/conversations')).body.items.length, 0, 'blocked chats disappear from the list');
    assert.equal((await b.api.get(`/api/messages/conversations/${id}/messages`)).status, 404);
  });

  test('read receipts can be turned off by the reader', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await b.api.put('/api/profiles/me/privacy', { readReceipts: false });
    const id = (await open(a, b)).body._id;
    await send(a, id, 'did you see this?');
    await b.api.post(`/api/messages/conversations/${id}/read`);
    assert.equal((await b.api.get('/api/messages/unread-count')).body.unread, 0, 'unread still clears');
    assert.equal((await a.api.get(`/api/messages/conversations/${id}/messages`)).body.items[0].readAt, null, 'but the sender is not told');
  });

  test('unsend: only the sender can delete, text is wiped and the preview updates', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = (await open(a, b)).body._id;
    await send(a, id, 'first');
    const second = (await send(a, id, 'oops')).body;
    assert.equal((await b.api.delete(`/api/messages/${second._id}`)).status, 404);
    assert.equal((await a.api.delete(`/api/messages/${second._id}`)).status, 200);
    const items = (await b.api.get(`/api/messages/conversations/${id}/messages`)).body.items;
    assert.equal(items[0].deleted, true);
    assert.equal(items[0].text, '');
    assert.equal((await b.api.get('/api/messages/conversations')).body.items[0].lastMessage.text, 'first');
  });

  test('deleting an account removes its conversations', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = (await open(a, b)).body._id;
    await send(a, id, 'bye');
    assert.equal((await a.api.delete('/api/auth/account', { password: a.password })).status, 200);
    assert.equal((await b.api.get('/api/messages/conversations')).body.items.length, 0);
    assert.equal(await t.mongoose.model('Message').countDocuments({ conversation: id }), 0);
  });
});

describe('photos, typing and presence', () => {
  // a real 8x8 PNG, generated at test time so the file is genuinely decodable
  const png = async () => (await import('sharp')).default({ create: { width: 8, height: 8, channels: 3, background: '#3366ff' } }).png().toBuffer();

  test('send a photo with or without text; unsend removes the file', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = (await open(a, b)).body._id;
    const url = `/api/messages/conversations/${id}/messages`;

    const photo = await a.api.post(url).attach('image', await png(), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(photo.status, 201);
    assert.match(photo.body.image, /\/uploads\/.+\.png$/);
    assert.equal(photo.body.text, '');
    assert.equal((await b.api.get('/api/messages/conversations')).body.items[0].lastMessage.text, '📷 Photo');

    const both = await a.api.post(url).field('text', 'look!').attach('image', await png(), { filename: 'y.png', contentType: 'image/png' });
    assert.equal(both.body.text, 'look!');

    const file = photo.body.image.split('/uploads/')[1];
    const fs = await import('fs');
    const path = await import('path');
    const { env } = await import('../src/config/env.js');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, file)), 'stored on disk');
    assert.equal((await a.api.delete(`/api/messages/${photo.body._id}`)).status, 200);
    assert.ok(!fs.existsSync(path.join(env.UPLOAD_DIR, file)), 'removed after unsend');
    const items = (await b.api.get(`${url}`)).body.items;
    assert.equal(items.find((m) => m._id === photo.body._id).image, null);
  });

  test('empty messages and fake images are rejected', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = (await open(a, b)).body._id;
    const url = `/api/messages/conversations/${id}/messages`;
    assert.equal((await a.api.post(url).send({ text: '' })).status, 400);
    const fake = await a.api.post(url).attach('image', Buffer.from('not an image at all'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(fake.status, 400);
    const pdf = await a.api.post(url).attach('image', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
    assert.equal(pdf.status, 400);
  });

  test('conversations report whether the other person is online', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { markOnline, markOffline } = await import('../src/sockets/realtime.js');
    const id = (await open(a, b)).body._id;
    assert.equal((await a.api.get(`/api/messages/conversations/${id}`)).body.other.online, false);
    markOnline(b._id);
    assert.equal((await a.api.get(`/api/messages/conversations/${id}`)).body.other.online, true);
    await b.api.put('/api/profiles/me/privacy', { showOnlineStatus: false });
    assert.equal((await a.api.get(`/api/messages/conversations/${id}`)).body.other.online, false, 'hidden when they opt out');
    markOffline(b._id);
  });
});
