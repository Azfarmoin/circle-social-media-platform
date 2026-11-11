import { User } from '../models/index.js';
import { unauthorized, forbidden } from '../utils/AppError.js';
import { verifyAccessToken, csrfCookieName } from '../services/tokenService.js';
import { isFamilyActive } from '../services/authService.js';

const lastTouch = new Map();

export const authenticate = async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token', err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'BAD_TOKEN');
  }

  if (!(await isFamilyActive(payload.fam))) throw unauthorized('Session ended', 'SESSION_REVOKED');
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') throw unauthorized('Account unavailable', 'ACCOUNT_UNAVAILABLE');

  req.user = user;
  req.family = payload.fam;

  // record activity at most every 5 minutes per user
  const now = Date.now();
  if (now - (lastTouch.get(String(user._id)) || 0) > 300000) {
    lastTouch.set(String(user._id), now);
    User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    if (lastTouch.size > 5000) lastTouch.clear();
  }
  next();
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw forbidden('Insufficient permissions', 'FORBIDDEN_ROLE');
  next();
};

// Double-submit CSRF check for the endpoints that authenticate with the refresh cookie.
export const requireCsrf = (req, _res, next) => {
  const cookie = req.cookies?.[csrfCookieName];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || cookie !== header) throw forbidden('CSRF token missing or invalid', 'CSRF');
  next();
};
