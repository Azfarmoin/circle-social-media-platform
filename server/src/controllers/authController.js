import { env } from '../config/env.js';
import * as auth from '../services/authService.js';
import { setAuthCookies, clearAuthCookies, refreshCookieName } from '../services/tokenService.js';

const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') || '' });

export const register = async (req, res) => {
  const { verifyUrl } = await auth.register(req.body);
  res.status(201).json({
    message: env.REQUIRE_EMAIL_VERIFICATION ? 'Account created. Check your email to verify your address.' : 'Account created. You can sign in now.',
    emailVerificationRequired: env.REQUIRE_EMAIL_VERIFICATION,
    ...(env.isDev && env.REQUIRE_EMAIL_VERIFICATION ? { devVerifyUrl: verifyUrl } : {}),
  });
};

export const verifyEmail = async (req, res) => {
  await auth.verifyEmail(req.body.token);
  res.json({ message: 'Email verified. You can sign in now.' });
};

export const resendVerification = async (req, res) => {
  await auth.resendVerification(req.body.email);
  res.json({ message: 'If that account exists and is unverified, a new link is on its way.' });
};

export const login = async (req, res) => {
  const result = await auth.login(req.body, ctxOf(req));
  if (result.twoFactorRequired) return res.json({ twoFactorRequired: true });
  setAuthCookies(res, result.refreshToken, result.remember);
  res.json({ accessToken: result.accessToken, user: auth.publicUser(result.user) });
};

export const refresh = async (req, res) => {
  try {
    const result = await auth.refresh(req.cookies?.[refreshCookieName], ctxOf(req));
    setAuthCookies(res, result.refreshToken, result.remember);
    res.json({ accessToken: result.accessToken, user: auth.publicUser(result.user) });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
};

export const logout = async (req, res) => {
  await auth.logout(req.cookies?.[refreshCookieName]);
  clearAuthCookies(res);
  res.json({ message: 'Signed out' });
};

export const logoutAll = async (req, res) => {
  await auth.revokeAllSessions(req.user._id);
  clearAuthCookies(res);
  res.json({ message: 'Signed out of every device' });
};

export const me = (req, res) => res.json({ user: auth.publicUser(req.user) });

export const forgotPassword = async (req, res) => {
  await auth.forgotPassword(req.body.email);
  res.json({ message: 'If that email belongs to an account, a reset link is on its way.' });
};

export const resetPassword = async (req, res) => {
  await auth.resetPassword(req.body.token, req.body.newPassword);
  res.json({ message: 'Password updated. Sign in with your new password.' });
};

export const changePassword = async (req, res) => {
  await auth.changePassword(req.user._id, req.family, req.body);
  res.json({ message: 'Password changed. Other devices were signed out.' });
};

export const sessions = async (req, res) => res.json({ items: await auth.listSessions(req.user._id, req.family) });

export const revokeSession = async (req, res) => {
  await auth.revokeSession(req.user._id, req.params.family);
  if (req.params.family === req.family) clearAuthCookies(res);
  res.json({ message: 'Session ended' });
};

export const loginHistory = async (req, res) => res.json({ items: await auth.loginHistory(req.user._id) });

export const twoFactorSetup = async (req, res) => res.json(await auth.twoFactorSetup(req.user._id));
export const twoFactorEnable = async (req, res) => res.json(await auth.twoFactorEnable(req.user._id, req.body.code));
export const twoFactorDisable = async (req, res) => {
  await auth.twoFactorDisable(req.user._id, req.body);
  res.json({ message: 'Two-factor authentication turned off' });
};

export const deactivate = async (req, res) => {
  await auth.deactivateAccount(req.user._id, req.body.password);
  clearAuthCookies(res);
  res.json({ message: 'Account deactivated. Sign in again any time to reactivate it.' });
};

export const deleteAccount = async (req, res) => {
  await auth.deleteAccount(req.user._id, req.body.password);
  clearAuthCookies(res);
  res.json({ message: 'Your account and its data were permanently deleted.' });
};
