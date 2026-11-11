// Seeds a realistic demo network. Usage:
//   npm run seed            add demo data (skips if it already exists)
//   npm run seed -- --reset drop the demo data first and rebuild it
// Every account uses the password "Password123!". Demo login: demo@circle.test
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { pairOf } from '../models/Relationships.js';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { cache } from '../config/cache.js';
import {
  User, Profile, Post, FriendRequest, Friendship, Follow, Comment, Reaction, PollVote, Notification, SavedItem, Hashtag, Report, Conversation, Message, pairKey,
} from '../models/index.js';
import { REACTIONS } from '../../../shared/constants.js';
import { extractHashtags } from '../utils/text.js';
import {
  FIRST, LAST, BIOS, CITIES, SCHOOLS, COMPANIES, POSITIONS, POSTS, COMMENTS, REPLIES, POLLS, FEELINGS, SVG_SCENES,
} from './data.js';

const PASSWORD = 'Password123!';

// deterministic PRNG so every run builds the same network
let seed = 20261008;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (arr, n) => shuffle(arr).slice(0, n);

// ObjectIds whose embedded timestamp matches the document's createdAt, so _id order == time order
const idAt = (ms) => new mongoose.Types.ObjectId(Math.floor(ms / 1000).toString(16).padStart(8, '0') + Array.from({ length: 16 }, () => Math.floor(rnd() * 16).toString(16)).join(''));

const NOW = Date.now();
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY);

async function writeAssets() {
  const dir = path.join(env.UPLOAD_DIR, 'seed');
  await fs.mkdir(dir, { recursive: true });
  const scenes = [];
  for (const [i, [c1, c2, name]] of SVG_SCENES.entries()) {
    const hills = `<path d="M0 420 Q200 300 400 400 T800 380 V600 H0Z" fill="#00000022"/><path d="M0 480 Q250 380 480 470 T800 450 V600 H0Z" fill="#00000033"/>`;
    const sun = `<circle cx="${180 + i * 45}" cy="${150 + (i % 3) * 30}" r="${50 + (i % 4) * 12}" fill="#ffffff66"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/>${sun}${hills}<title>${name}</title></svg>`;
    await fs.writeFile(path.join(dir, `scene-${i}.svg`), svg);
    scenes.push(`/uploads/seed/scene-${i}.svg`);
  }
  return scenes;
}

async function writeAvatar(username, name, i) {
  const dir = path.join(env.UPLOAD_DIR, 'seed');
  const hue = (i * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,48%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="128" font-family="Inter,Arial,sans-serif" font-size="88" font-weight="700" fill="#fff" text-anchor="middle">${name.slice(0, 1).toUpperCase()}</text></svg>`;
  await fs.writeFile(path.join(dir, `avatar-${username}.svg`), svg);
  return `/uploads/seed/avatar-${username}.svg`;
}

/**
 * Builds the demo network. Assumes the database connection is already open.
 * Returns { seeded: boolean } (false when demo data was already there and reset is off).
 */
export async function seedDemo({ reset = false, force = false, log = console.log } = {}) {
  if (env.isProd && !force) throw new Error('Refusing to seed a production database without --force');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  if (await User.exists({ email: 'demo@circle.test' })) {
    if (!reset) {
      log('Demo data already present. Run with --reset to rebuild it.');
      return { seeded: false };
    }
    await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
    log('Existing data cleared.');
  }

  const scenes = await writeAssets();
  const passwordHash = await bcrypt.hash(PASSWORD, env.BCRYPT_ROUNDS);

  // ------------------------------------------------------------------ users
  const people = [
    { username: 'admin', name: 'Circle Admin', email: 'admin@circle.test', role: 'admin', verifiedBadge: true, bio: 'Keeping Circle friendly.' },
    { username: 'moderator', name: 'Maya Moderator', email: 'moderator@circle.test', role: 'moderator', verifiedBadge: true, bio: 'Community safety.' },
    { username: 'demo', name: 'Demo User', email: 'demo@circle.test', role: 'user', bio: 'Trying out Circle. Say hi!' },
  ];
  const used = new Set(people.map((p) => p.username));
  const names = shuffle(FIRST.flatMap((f) => [pick(LAST)].map((l) => `${f} ${l}`)));
  for (const full of names) {
    const [f, l] = full.split(' ');
    const username = `${f}_${l}`.toLowerCase();
    if (used.has(username)) continue;
    used.add(username);
    people.push({ username, name: full, email: `${username}@circle.test`, role: 'user', verifiedBadge: chance(0.08), bio: pick(BIOS) });
  }

  const users = [];
  for (const [i, p] of people.entries()) {
    users.push({
      _id: idAt(NOW - (60 - Math.min(i, 55)) * DAY),
      ...p,
      passwordHash,
      emailVerified: true,
      avatar: await writeAvatar(p.username, p.name, i),
      cover: chance(0.7) ? scenes[i % scenes.length] : '',
      friendCount: 0, followerCount: 0, followingCount: 0,
      createdAt: ago(60 - Math.min(i, 55)),
      lastSeenAt: ago(rnd() * 3),
    });
  }
  const byUsername = Object.fromEntries(users.map((u) => [u.username, u]));
  const demo = byUsername.demo;
  const regular = users.filter((u) => !['admin', 'moderator'].includes(u.username));

  // ------------------------------------------------------------------ friendships and follows
  const friendPairs = new Set();
  const pairKey = (a, b) => (String(a._id) < String(b._id) ? `${a._id}:${b._id}` : `${b._id}:${a._id}`);
  const befriend = (a, b) => { if (a !== b) friendPairs.add(pairKey(a, b)); };
  regular.forEach((u) => sample(regular, 5 + Math.floor(rnd() * 6)).forEach((o) => befriend(u, o)));
  sample(regular.filter((u) => u !== demo), 14).forEach((o) => befriend(demo, o));
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const friendships = [];
  const follows = new Set();
  for (const key of friendPairs) {
    const [a, b] = key.split(':');
    friendships.push({ a: new mongoose.Types.ObjectId(a), b: new mongoose.Types.ObjectId(b), createdAt: ago(rnd() * 50) });
    byId.get(a).friendCount++; byId.get(b).friendCount++;
    follows.add(`${a}>${b}`); follows.add(`${b}>${a}`);
  }
  // extra one-way follows towards popular accounts
  for (const u of regular) for (const target of sample(regular, 3)) if (target !== u && !friendPairs.has(pairKey(u, target))) follows.add(`${u._id}>${target._id}`);
  const followDocs = [...follows].map((k) => {
    const [f, t] = k.split('>');
    byId.get(f).followingCount++; byId.get(t).followerCount++;
    return { follower: new mongoose.Types.ObjectId(f), following: new mongoose.Types.ObjectId(t), createdAt: ago(rnd() * 50) };
  });

  const demoFriends = new Set(friendships.filter((f) => String(f.a) === String(demo._id) || String(f.b) === String(demo._id)).map((f) => String(String(f.a) === String(demo._id) ? f.b : f.a)));
  const strangers = regular.filter((u) => u !== demo && !demoFriends.has(String(u._id)));
  const requests = [
    ...strangers.slice(0, 3).map((u) => ({ from: u._id, to: demo._id, status: 'pending', createdAt: ago(rnd() * 3) })),
    ...strangers.slice(3, 5).map((u) => ({ from: demo._id, to: u._id, status: 'pending', createdAt: ago(rnd() * 3) })),
  ];

  // ------------------------------------------------------------------ posts
  const friendsOf = (u) => friendships.filter((f) => String(f.a) === String(u._id) || String(f.b) === String(u._id)).map((f) => String(String(f.a) === String(u._id) ? f.b : f.a));
  const posts = [];
  const hashtagCounts = new Map();
  const mkPost = (author, overrides = {}) => {
    const created = overrides.createdAt || new Date(NOW - rnd() * 30 * DAY);
    const text = overrides.text ?? pick(POSTS);
    const r = rnd();
    const audience = overrides.audience || (r < 0.6 ? 'public' : r < 0.9 ? 'friends' : r < 0.94 ? 'only_me' : r < 0.97 ? 'friends_except' : 'specific');
    const mine = friendsOf(author);
    const doc = {
      _id: idAt(created.getTime()),
      author: author._id,
      type: 'text',
      text,
      media: [],
      audience,
      audienceList: audience === 'friends_except' || audience === 'specific' ? sample(mine, Math.min(3, mine.length)).map((id) => new mongoose.Types.ObjectId(id)) : [],
      authorActive: true,
      hashtags: extractHashtags(text),
      tags: [], mentions: [],
      location: chance(0.2) ? pick(CITIES) : '',
      feeling: chance(0.12) ? { label: pick(FEELINGS), emoji: '' } : undefined,
      reactionCounts: Object.fromEntries(REACTIONS.map((x) => [x, 0])), reactionTotal: 0, commentCount: 0, shareCount: 0,
      pinned: false,
      createdAt: created, updatedAt: created,
      ...overrides,
    };
    if (audience === 'specific' && !doc.audienceList.length) doc.audience = 'public';
    doc.hashtags.forEach((t) => hashtagCounts.set(t, (hashtagCounts.get(t) || 0) + 1));
    posts.push(doc);
    return doc;
  };

  for (let i = 0; i < 118; i++) {
    const author = i < 12 ? demo : pick(regular);
    const p = mkPost(author, i < 6 ? { audience: i % 2 ? 'public' : 'friends' } : {});
    if (chance(0.28)) { p.media = [{ url: pick(scenes), kind: 'image' }]; p.type = 'photo'; }
    if (chance(0.06)) { p.media = sample(scenes, 3).map((url) => ({ url, kind: 'image' })); p.type = 'photo'; }
  }
  // polls
  const pollPosts = POLLS.map((poll, i) => {
    const author = i === 0 ? demo : pick(regular);
    const p = mkPost(author, { text: poll.question, audience: 'public', hashtags: [], createdAt: ago(1 + i * 2 + rnd()) });
    p.type = 'poll';
    p.poll = { question: poll.question, multiple: false, endsAt: new Date(NOW + (2 + i) * DAY), totalVotes: 0, counts: {}, options: poll.options.map((text) => ({ _id: new mongoose.Types.ObjectId(), text })) };
    return p;
  });
  // shares of public posts
  const shareable = posts.filter((p) => p.audience === 'public' && p.type !== 'poll');
  for (let i = 0; i < 7; i++) {
    const original = pick(shareable);
    const sharer = pick(regular.filter((u) => String(u._id) !== String(original.author)));
    const created = new Date(original.createdAt.getTime() + rnd() * 2 * DAY);
    const s = mkPost(sharer, { text: pick(['Worth a look.', 'Couldn’t say it better.', 'This.', 'Sharing for the people who missed it.']), audience: 'public', hashtags: [], createdAt: created > NOW ? new Date(NOW - 3600000) : created });
    s.type = 'share'; s.sharedPost = original._id; original.shareCount++;
  }
  // pins
  [demo, ...sample(regular, 3)].forEach((u) => { const own = posts.filter((p) => String(p.author) === String(u._id) && p.audience === 'public'); if (own.length) pick(own).pinned = true; });
  posts.sort((a, b) => a._id.toString().localeCompare(b._id.toString()));

  // ------------------------------------------------------------------ audience-aware engagement
  const canSee = (p, uid) => {
    const id = String(uid);
    if (String(p.author) === id) return true;
    if (p.audience === 'public') return true;
    const fr = new Set(friendsOf(byId.get(String(p.author))));
    if (p.audience === 'friends') return fr.has(id);
    if (p.audience === 'friends_except') return fr.has(id) && !p.audienceList.map(String).includes(id);
    if (p.audience === 'specific') return p.audienceList.map(String).includes(id);
    return false;
  };
  const friendCache = new Map();
  const friendSetOf = (u) => { if (!friendCache.has(String(u._id))) friendCache.set(String(u._id), new Set(friendsOf(u))); return friendCache.get(String(u._id)); };
  void friendSetOf;

  const comments = [];
  const reactions = [];
  const notifications = [];
  const pollVotes = [];
  const reactionKey = new Set();

  for (const p of posts) {
    const audience = regular.filter((u) => canSee(p, u._id));
    if (!audience.length) continue;
    const popularity = p.audience === 'public' ? 1 : 0.6;

    // reactions
    for (const u of sample(audience, Math.floor(rnd() * 9 * popularity))) {
      const key = `${u._id}:${p._id}`;
      if (reactionKey.has(key)) continue;
      reactionKey.add(key);
      const type = chance(0.55) ? 'like' : chance(0.5) ? 'love' : pick(REACTIONS);
      const created = new Date(p.createdAt.getTime() + rnd() * 2 * DAY);
      reactions.push({ user: u._id, targetType: 'post', target: p._id, type, createdAt: created > NOW ? new Date(NOW) : created });
      p.reactionCounts[type]++; p.reactionTotal++;
      if (String(p.author) === String(demo._id) || chance(0.12)) notifications.push({ recipient: p.author, actor: u._id, type: 'reaction', post: p._id, meta: { reaction: type, targetType: 'post' }, createdAt: created });
    }

    // comments and replies
    for (const u of sample(audience, Math.floor(rnd() * 4 * popularity))) {
      const created = new Date(p.createdAt.getTime() + rnd() * 2 * DAY);
      const c = { _id: idAt(Math.min(created.getTime(), NOW)), post: p._id, author: u._id, parent: null, text: pick(COMMENTS), reactionCounts: Object.fromEntries(REACTIONS.map((x) => [x, 0])), reactionTotal: 0, replyCount: 0, pinned: false, mentions: [], createdAt: created > NOW ? new Date(NOW) : created, updatedAt: created };
      comments.push(c); p.commentCount++;
      if (String(p.author) === String(demo._id) || chance(0.12)) notifications.push({ recipient: p.author, actor: u._id, type: 'comment', post: p._id, comment: c._id, meta: { excerpt: c.text }, createdAt: c.createdAt });
      if (chance(0.45)) {
        const replier = String(p.author) === String(u._id) ? pick(audience) : byId.get(String(p.author));
        if (replier && String(replier._id) !== String(u._id)) {
          const rc = new Date(Math.min(c.createdAt.getTime() + rnd() * DAY, NOW));
          comments.push({ _id: idAt(rc.getTime()), post: p._id, author: replier._id, parent: c._id, replyTo: u._id, text: pick(REPLIES), reactionCounts: Object.fromEntries(REACTIONS.map((x) => [x, 0])), reactionTotal: 0, replyCount: 0, pinned: false, mentions: [], createdAt: rc, updatedAt: rc });
          c.replyCount++; p.commentCount++;
          notifications.push({ recipient: u._id, actor: replier._id, type: 'reply', post: p._id, comment: c._id, meta: { excerpt: REPLIES[0] }, createdAt: rc });
        }
      }
    }
  }
  // a few reactions on comments
  for (const c of sample(comments.filter((x) => !x.parent), 60)) {
    const p = posts.find((x) => String(x._id) === String(c.post));
    for (const u of sample(regular.filter((r) => canSee(p, r._id)), 1 + Math.floor(rnd() * 3))) {
      const type = pick(REACTIONS);
      reactions.push({ user: u._id, targetType: 'comment', target: c._id, type, createdAt: new Date(NOW - rnd() * DAY) });
      c.reactionCounts[type]++; c.reactionTotal++;
    }
  }
  // poll votes
  for (const p of pollPosts) {
    for (const u of sample(regular, 6 + Math.floor(rnd() * 14))) {
      const opt = pick(p.poll.options);
      pollVotes.push({ post: p._id, user: u._id, options: [opt._id], createdAt: new Date(NOW - rnd() * DAY) });
      p.poll.counts[String(opt._id)] = (p.poll.counts[String(opt._id)] || 0) + 1;
      p.poll.totalVotes++;
    }
  }

  // notifications for the demo account: requests, plus enough activity to look lived-in
  for (const r of requests.filter((x) => String(x.to) === String(demo._id))) notifications.push({ recipient: demo._id, actor: r.from, type: 'friend_request', meta: {}, createdAt: r.createdAt });
  const notifDocs = notifications
    .filter((n) => String(n.recipient) !== String(n.actor))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 400)
    .map((n, i) => ({ ...n, _id: idAt(Math.min(n.createdAt.getTime(), NOW)), read: i > 12, updatedAt: n.createdAt }));

  const saved = sample(posts.filter((p) => p.audience === 'public'), 5).map((p, i) => ({ user: demo._id, post: p._id, folder: i < 3 ? 'All' : 'Recipes', createdAt: ago(i) }));

  // ------------------------------------------------------------------ profiles, reports, hashtags
  const profiles = users.map((u, i) => ({
    user: u._id,
    website: chance(0.3) ? `https://${u.username.replace('_', '')}.example.com` : '',
    location: pick(CITIES),
    education: chance(0.7) ? [{ school: pick(SCHOOLS), degree: pick(['BSc Computer Science', 'BA Design', 'MBA', 'BEng', 'MSc Data Science']), from: 2010 + (i % 8), to: 2014 + (i % 8) }] : [],
    work: chance(0.8) ? [{ company: pick(COMPANIES), position: pick(POSITIONS), from: 2018 + (i % 5) }] : [],
    relationshipStatus: pick(['', 'single', 'in_a_relationship', 'married', '']),
    birthday: new Date(1984 + (i % 18), i % 12, 1 + (i % 27)),
    languages: sample(['English', 'Urdu', 'Spanish', 'Turkish', 'Arabic', 'French', 'Portuguese', 'Hindi'], 1 + (i % 3)),
    privacy: {
      profileVisibility: 'everyone', aboutVisibility: 'everyone', friendListVisibility: 'everyone', birthdayVisibility: 'friends',
      defaultPostAudience: 'friends', whoCanSendFriendRequests: 'everyone', whoCanFollow: 'everyone', whoCanTag: 'friends', whoCanComment: 'everyone', whoCanMessage: 'everyone', showOnlineStatus: true, readReceipts: true,
    },
    createdAt: u.createdAt, updatedAt: u.createdAt,
  }));

  const publicPosts = posts.filter((p) => p.audience === 'public');
  const reports = sample(publicPosts, 3).map((p, i) => ({ reporter: pick(regular)._id, targetType: 'post', target: p._id, targetOwner: p.author, category: ['spam', 'harassment', 'scam'][i], details: ['Looks like promotional spam.', 'Rude to another member.', 'Suspicious link.'][i], status: 'open', createdAt: ago(i * 0.5) }));
  const hashtags = [...hashtagCounts].map(([tag, postCount]) => ({ tag, postCount, lastUsedAt: new Date() }));

  // ------------------------------------------------------------------ direct messages (demo chats with a few friends)
  const SCRIPTS = [
    [['them', 'Hey! Saw your latest post, nice one.'], ['me', 'Thanks! Still getting used to Circle.'], ['them', 'Same here. Are you coming on Saturday?'], ['me', 'Definitely. I will bring snacks.'], ['them', 'Perfect, see you then!']],
    [['me', 'Did you get a chance to look at the draft?'], ['them', 'Yes, left a few comments. Mostly small things.'], ['me', 'Great, I will go through them tonight.']],
    [['them', 'Quick question: do you know a good place for coffee near the station?'], ['them', 'Asking for a friend visiting next week.']],
    [['them', 'Happy birthday! Hope it is a good one.'], ['me', 'Thank you so much!']],
  ];
  const chatPartners = sample([...demoFriends].map((id) => users.find((u) => String(u._id) === id)).filter(Boolean), SCRIPTS.length);
  const conversations = [];
  const messageDocs = [];
  chatPartners.forEach((other, i) => {
    const { a, b } = pairOf(demo._id, other._id);
    const convId = new mongoose.Types.ObjectId();
    const script = SCRIPTS[i];
    let unread = 0;
    script.forEach(([who, text], j) => {
      const at = new Date(NOW - (script.length - j) * 3600 * 1000 * (i + 1));
      const fromThem = who === 'them';
      const sender = fromThem ? other._id : demo._id;
      // the demo user has unread messages in the first two chats so the badge is visible
      const isUnread = fromThem && i < 2 && script.slice(j).every(([w]) => w === 'them');
      if (isUnread) unread += 1;
      messageDocs.push({ _id: new mongoose.Types.ObjectId(Math.floor(at.getTime() / 1000).toString(16).padStart(8, '0') + new mongoose.Types.ObjectId().toString().slice(8)), conversation: convId, sender, text, readAt: isUnread ? undefined : at, createdAt: at });
    });
    const last = messageDocs[messageDocs.length - 1];
    const unreadDemo = unread;
    conversations.push({ _id: convId, a, b, pair: pairKey(demo._id, other._id), lastMessage: { text: last.text, sender: last.sender, at: last.createdAt }, unreadA: String(a) === String(demo._id) ? unreadDemo : 0, unreadB: String(b) === String(demo._id) ? unreadDemo : 0, createdAt: messageDocs.find((m) => m.conversation === convId).createdAt, updatedAt: last.createdAt, __v: 0 });
  });

  // ------------------------------------------------------------------ write everything
  await User.collection.insertMany(users.map((u) => ({ ...u, updatedAt: u.createdAt, notificationPrefs: { friend_request: true, friend_accept: true, follow: true, reaction: true, comment: true, reply: true, mention: true, tag: true, share: true, emailFriendRequests: false, emailSecurityAlerts: true }, hiddenPosts: [], snoozed: [], recentSearches: [], twoFactor: { enabled: false, recoveryHashes: [] }, failedLogins: 0, status: 'active', __v: 0 })));
  await Profile.collection.insertMany(profiles);
  await Friendship.collection.insertMany(friendships);
  await Follow.collection.insertMany(followDocs);
  await FriendRequest.collection.insertMany(requests.map((r) => ({ ...r, updatedAt: r.createdAt })));
  await Post.collection.insertMany(posts.map((p) => ({ ...p, __v: 0, tags: p.tags, mentions: p.mentions, feeling: p.feeling?.label ? { label: p.feeling.label, emoji: '' } : undefined })));
  if (comments.length) await Comment.collection.insertMany(comments.map((c) => ({ ...c, __v: 0 })));
  if (reactions.length) await Reaction.collection.insertMany(reactions.map((r) => ({ ...r, updatedAt: r.createdAt })));
  if (pollVotes.length) await PollVote.collection.insertMany(pollVotes.map((v) => ({ ...v, updatedAt: v.createdAt })));
  if (notifDocs.length) await Notification.collection.insertMany(notifDocs);
  await SavedItem.collection.insertMany(saved);
  await Hashtag.collection.insertMany(hashtags);
  await Conversation.collection.insertMany(conversations);
  await Message.collection.insertMany(messageDocs.map((m) => ({ ...m, __v: 0 })));
  await Report.collection.insertMany(reports.map((r) => ({ ...r, updatedAt: r.createdAt })));

  log(`Seeded ${users.length} users, ${friendships.length} friendships, ${followDocs.length} follows, ${posts.length} posts (${pollPosts.length} polls), ${comments.length} comments, ${reactions.length} reactions, ${notifDocs.length} notifications, ${hashtags.length} hashtags, ${conversations.length} conversations.`);
  log('Sign in as demo@circle.test / Password123!  (admin@circle.test and moderator@circle.test share the password)');
  return { seeded: true };
}

// Command line: npm run seed [-- --reset] [--force]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  (async () => {
    await connectDb();
    await seedDemo({ reset: process.argv.includes('--reset'), force: process.argv.includes('--force') });
  })()
    .catch((err) => { console.error(err.message || err); process.exitCode = 1; })
    .finally(async () => { await cache.close(); await disconnectDb(); });
}
