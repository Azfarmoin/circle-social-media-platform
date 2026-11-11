import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { randomToken, sha256 } from '../utils/crypto.js';

export const signAccessToken = (user, family) =>
  jwt.sign({ sub: String(user._id), role: user.role, fam: family }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TTL_SEC,
    algorithm: 'HS256',
    issuer: 'circle',
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'circle' });

export const newRefreshToken = () => {
  const raw = randomToken(48);
  return { raw, hash: sha256(raw) };
};

export const refreshCookieName = 'rt';
export const csrfCookieName = 'csrf';

export const refreshCookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: maxAgeMs,
});

export const csrfCookieOptions = (maxAgeMs) => ({
  httpOnly: false,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/',
  maxAge: maxAgeMs,
});

export const setAuthCookies = (res, rawRefresh, remember) => {
  const days = remember ? env.REFRESH_TTL_REMEMBER_DAYS : env.REFRESH_TTL_DAYS;
  const maxAge = days * 86400 * 1000;
  res.cookie(refreshCookieName, rawRefresh, refreshCookieOptions(maxAge));
  res.cookie(csrfCookieName, randomToken(24), csrfCookieOptions(maxAge));
};

export const clearAuthCookies = (res) => {
  res.clearCookie(refreshCookieName, { path: '/api/auth' });
  res.clearCookie(csrfCookieName, { path: '/' });
};
