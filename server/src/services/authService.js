import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { User, Profile, Session, LoginEvent, Post } from '../models/index.js';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../utils/AppError.js';
import { randomToken, sha256, generateTotpSecret, verifyTotp } from '../utils/crypto.js';
import { deviceLabel } from '../utils/text.js';
import { signAccessToken, newRefreshToken } from './tokenService.js';
import { sendMail, mailTemplates } from './mailService.js';
import { disconnectFamily, disconnectUser } from '../sockets/realtime.js';
import { notify } from './notificationService.js';
import { deleteAccountData } from './accountCleanup.js';

const DAY = 86400 * 1000;
// A fixed hash used to equalize timing when the account does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

export const hashPassword = (plain) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export const publicUser = (u) => ({
  _id: u._id,
  username: u.username,
  email: u.email,
  name: u.name,
  bio: u.bio,
  avatar: u.avatar,
  cover: u.cover,
  role: u.role,
  verifiedBadge: u.verifiedBadge,
  emailVerified: u.emailVerified,
  twoFactorEnabled: !!u.twoFactor?.enabled,
  friendCount: u.friendCount,
  followerCount: u.followerCount,
  followingCount: u.followingCount,
  notificationPrefs: u.notificationPrefs,
  createdAt: u.createdAt,
});

// ------------------------------------------------------------------ registration & verification
export async function register({ username, email, password, name }) {
  const existing = await User.findOne({ $or: [{ email }, { username }] }).select('email username').lean();
  if (existing) {
    // Same message either way so the endpoint cannot be used to enumerate accounts by email.
    throw conflict('That username or email is already taken', 'ACCOUNT_EXISTS');
  }
  const token = randomToken(32);
  const user = await User.create({
    username,
    email,
    name,
    passwordHash: await hashPassword(password),
    emailVerified: !env.REQUIRE_EMAIL_VERIFICATION,
    verifyTokenHash: sha256(token),
    verifyTokenExpires: new Date(Date.now() + DAY),
  });
  await Profile.create({ user: user._id });

  const url = `${env.CLIENT_URL}/verify-email?token=${token}`;
  if (env.REQUIRE_EMAIL_VERIFICATION) await sendMail({ to: email, ...mailTemplates.verify(name, url) });
  return { user, verifyUrl: url };
}

export async function verifyEmail(token) {
  const user = await User.findOne({ verifyTokenHash: sha256(token), verifyTokenExpires: { $gt: new Date() } }).select('+verifyTokenHash');
  if (!user) throw badRequest('This verification link is invalid or has expired', 'BAD_TOKEN');
  user.emailVerified = true;
  user.verifyTokenHash = undefined;
  user.verifyTokenExpires = undefined;
  await user.save();
  return user;
}

export async function resendVerification(email) {
  const user = await User.findOne({ email });
  if (!user || user.emailVerified) return; // silent: never reveal whether the account exists
  const token = randomToken(32);
  user.verifyTokenHash = sha256(token);
  user.verifyTokenExpires = new Date(Date.now() + DAY);
  await user.save();
  await sendMail({ to: email, ...mailTemplates.verify(user.name, `${env.CLIENT_URL}/verify-email?token=${token}`) });
}

// ------------------------------------------------------------------ sessions
async function createSession(user, ctx, { remember, family = crypto.randomUUID() } = {}) {
  const { raw, hash } = newRefreshToken();
  const days = remember ? env.REFRESH_TTL_REMEMBER_DAYS : env.REFRESH_TTL_DAYS;
  const session = await Session.create({
    user: user._id,
    family,
    tokenHash: hash,
    userAgent: ctx.userAgent || '',
    device: deviceLabel(ctx.userAgent),
    ip: ctx.ip || '',
    remember: !!remember,
    expiresAt: new Date(Date.now() + days * DAY),
  });
  return { session, refreshToken: raw, accessToken: signAccessToken(user, family) };
}

export async function refresh(rawToken, ctx) {
  if (!rawToken) throw unauthorized('Missing refresh token', 'NO_REFRESH');
  const session = await Session.findOne({ tokenHash: sha256(rawToken) });
  if (!session) throw unauthorized('Invalid refresh token', 'BAD_REFRESH');

  if (session.revokedAt) throw unauthorized('Session was revoked', 'SESSION_REVOKED');
  if (session.rotatedAt) {
    // A token that was already exchanged is being replayed: assume it leaked, kill the whole family.
    await revokeFamily(session.family);
    throw unauthorized('Refresh token reuse detected. Please sign in again.', 'TOKEN_REUSE');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired', 'SESSION_EXPIRED');

  const user = await User.findById(session.user);
  if (!user || user.status !== 'active') throw unauthorized('Account unavailable', 'ACCOUNT_UNAVAILABLE');

  // Atomic compare-and-set so two concurrent refreshes cannot both win.
  const claimed = await Session.findOneAndUpdate({ _id: session._id, rotatedAt: null }, { $set: { rotatedAt: new Date(), lastUsedAt: new Date() } });
  if (!claimed) {
    await revokeFamily(session.family);
    throw unauthorized('Refresh token reuse detected. Please sign in again.', 'TOKEN_REUSE');
  }

  const next = await createSession(user, { ...ctx, userAgent: ctx.userAgent || session.userAgent }, { remember: session.remember, family: session.family });
  return { user, accessToken: next.accessToken, refreshToken: next.refreshToken, remember: session.remember };
}

export async function revokeFamily(family) {
  await Session.updateMany({ family, revokedAt: null }, { $set: { revokedAt: new Date() } });
  disconnectFamily(family);
}

export async function logout(rawToken) {
  if (!rawToken) return;
  const session = await Session.findOne({ tokenHash: sha256(rawToken) }).select('family');
  if (session) await revokeFamily(session.family);
}

export async function revokeAllSessions(userId, exceptFamily) {
  const filter = { user: userId, revokedAt: null };
  if (exceptFamily) filter.family = { $ne: exceptFamily };
  const families = await Session.distinct('family', filter);
  await Session.updateMany(filter, { $set: { revokedAt: new Date() } });
  families.forEach(disconnectFamily);
}

export async function listSessions(userId, currentFamily) {
  const live = await Session.find({ user: userId, revokedAt: null, rotatedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
  return live.map((s) => ({
    family: s.family,
    device: s.device,
    ip: s.ip,
    lastUsedAt: s.lastUsedAt,
    createdAt: s.createdFamilyAt || s.createdAt,
    current: s.family === currentFamily,
  }));
}

export async function revokeSession(userId, family) {
  const owned = await Session.exists({ user: userId, family });
  if (!owned) throw new AppError(404, 'Session not found', 'NOT_FOUND');
  await revokeFamily(family);
}

export async function isFamilyActive(family) {
  return !!(await Session.exists({ family, revokedAt: null, rotatedAt: null, expiresAt: { $gt: new Date() } }));
}

// ------------------------------------------------------------------ login
async function recordLogin(user, ctx, success, reason = '') {
  const device = deviceLabel(ctx.userAgent);
  await LoginEvent.create({
    user: user._id,
    success,
    reason,
    ip: ctx.ip || '',
    userAgent: (ctx.userAgent || '').slice(0, 300),
    device,
    deviceKey: sha256(`${device}`).slice(0, 16),
  });
}

async function registerFailure(user, ctx, reason) {
  user.failedLogins = (user.failedLogins || 0) + 1;
  if (user.failedLogins >= env.MAX_LOGIN_ATTEMPTS) {
    user.lockUntil = new Date(Date.now() + env.LOCK_MINUTES * 60000);
    user.failedLogins = 0;
  }
  await user.save();
  await recordLogin(user, ctx, false, reason);
}

export async function login({ identifier, password, otp, remember }, ctx) {
  const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+passwordHash +twoFactor.secret +twoFactor.recoveryHashes');
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Incorrect email/username or password', 'BAD_CREDENTIALS');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 'ACCOUNT_LOCKED');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await registerFailure(user, ctx, 'bad_password');
    throw unauthorized('Incorrect email/username or password', 'BAD_CREDENTIALS');
  }

  if (user.status === 'banned') throw forbidden('This account has been banned', 'ACCOUNT_BANNED');
  if (user.status === 'suspended') throw forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) throw forbidden('Please verify your email address before signing in', 'EMAIL_NOT_VERIFIED');

  if (user.twoFactor?.enabled) {
    if (!otp) return { twoFactorRequired: true };
    const okOtp = await consumeSecondFactor(user, otp);
    if (!okOtp) {
      await registerFailure(user, ctx, 'bad_otp');
      throw unauthorized('Invalid authentication code', 'BAD_OTP');
    }
  }

  const device = deviceLabel(ctx.userAgent);
  const deviceKey = sha256(`${device}`).slice(0, 16);
  const knownDevice = await LoginEvent.exists({ user: user._id, success: true, deviceKey });
  const hadAnyLogin = await LoginEvent.exists({ user: user._id, success: true });

  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastSeenAt = new Date();
  if (user.status === 'deactivated') {
    user.status = 'active';
    user.deactivatedAt = undefined;
    await Post.updateMany({ author: user._id }, { $set: { authorActive: true } });
  }
  await user.save();
  await recordLogin(user, ctx, true);

  if (hadAnyLogin && !knownDevice) {
    if (user.notificationPrefs?.emailSecurityAlerts !== false) sendMail({ to: user.email, ...mailTemplates.newDevice(user.name, device, ctx.ip) });
    notify({ recipient: user._id, type: 'security_alert', meta: { device, ip: ctx.ip } }).catch(() => {});
  }

  const { session, accessToken, refreshToken } = await createSession(user, ctx, { remember });
  return { user, accessToken, refreshToken, remember: !!remember, family: session.family };
}

export const loginHistory = (userId, limit = 20) => LoginEvent.find({ user: userId }).sort({ _id: -1 }).limit(limit).select('-userAgent -deviceKey').lean();

// ------------------------------------------------------------------ passwords
export async function changePassword(userId, currentFamily, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw forbidden('Current password is incorrect', 'BAD_PASSWORD');
  if (currentPassword === newPassword) throw badRequest('Choose a password you have not used just now', 'SAME_PASSWORD');
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(userId, currentFamily);
  sendMail({ to: user.email, ...mailTemplates.passwordChanged(user.name) });
}

export async function forgotPassword(email) {
  const user = await User.findOne({ email, status: { $in: ['active', 'deactivated'] } });
  if (!user) return; // same response either way
  const token = randomToken(32);
  user.resetTokenHash = sha256(token);
  user.resetTokenExpires = new Date(Date.now() + 3600 * 1000);
  await user.save();
  await sendMail({ to: email, ...mailTemplates.reset(user.name, `${env.CLIENT_URL}/reset-password?token=${token}`) });
}

export async function resetPassword(token, newPassword) {
  const user = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash');
  if (!user) throw badRequest('This reset link is invalid or has expired', 'BAD_TOKEN');
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.failedLogins = 0;
  user.lockUntil = undefined;
  await user.save();
  await revokeAllSessions(user._id);
  sendMail({ to: user.email, ...mailTemplates.passwordChanged(user.name) });
}

// ------------------------------------------------------------------ two-factor
async function consumeSecondFactor(user, code) {
  const clean = String(code).replace(/\s|-/g, '');
  if (/^\d{6}$/.test(clean)) return verifyTotp(user.twoFactor.secret, clean);
  const hash = sha256(clean.toLowerCase());
  if (user.twoFactor.recoveryHashes?.includes(hash)) {
    user.twoFactor.recoveryHashes = user.twoFactor.recoveryHashes.filter((h) => h !== hash);
    await user.save();
    return true;
  }
  return false;
}

export async function twoFactorSetup(userId) {
  const user = await User.findById(userId);
  const secret = generateTotpSecret();
  user.twoFactor.pendingSecret = secret;
  await user.save();
  const label = encodeURIComponent(`Circle:${user.email}`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Circle&digits=6&period=30` };
}

export async function twoFactorEnable(userId, code) {
  const user = await User.findById(userId).select('+twoFactor.pendingSecret +twoFactor.secret +twoFactor.recoveryHashes');
  if (!user.twoFactor.pendingSecret) throw badRequest('Start two-factor setup first', 'NO_SETUP');
  if (!verifyTotp(user.twoFactor.pendingSecret, code)) throw badRequest('That code is not valid. Check your authenticator app and try again.', 'BAD_OTP');
  const recovery = Array.from({ length: 8 }, () => randomToken(5));
  user.twoFactor.secret = user.twoFactor.pendingSecret;
  user.twoFactor.pendingSecret = undefined;
  user.twoFactor.enabled = true;
  user.twoFactor.recoveryHashes = recovery.map((c) => sha256(c));
  await user.save();
  return { recoveryCodes: recovery };
}

export async function twoFactorDisable(userId, { password, code }) {
  const user = await User.findById(userId).select('+passwordHash +twoFactor.secret +twoFactor.recoveryHashes');
  if (!(await bcrypt.compare(password, user.passwordHash))) throw forbidden('Password is incorrect', 'BAD_PASSWORD');
  if (!user.twoFactor.enabled) return;
  if (!(await consumeSecondFactor(user, code))) throw badRequest('Invalid authentication code', 'BAD_OTP');
  user.twoFactor.enabled = false;
  user.twoFactor.secret = undefined;
  user.twoFactor.recoveryHashes = [];
  await user.save();
}

// ------------------------------------------------------------------ account lifecycle
async function assertPassword(userId, password) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!(await bcrypt.compare(password, user.passwordHash))) throw forbidden('Password is incorrect', 'BAD_PASSWORD');
  return user;
}

export async function deactivateAccount(userId, password) {
  const user = await assertPassword(userId, password);
  user.status = 'deactivated';
  user.deactivatedAt = new Date();
  await user.save();
  await Post.updateMany({ author: userId }, { $set: { authorActive: false } });
  await revokeAllSessions(userId);
  disconnectUser(userId);
}

export async function deleteAccount(userId, password) {
  await assertPassword(userId, password);
  await revokeAllSessions(userId);
  await deleteAccountData(userId);
  disconnectUser(userId);
}
