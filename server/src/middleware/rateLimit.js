import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const make = ({ windowMs, limit, message, keyByUser = false }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.RATE_LIMIT_DISABLED,
    keyGenerator: keyByUser ? (req) => (req.user ? `u:${req.user._id}` : req.ip) : undefined,
    handler: (_req, res) => res.status(429).json({ message, code: 'RATE_LIMITED' }),
  });

// whole API, per IP
export const globalLimiter = make({ windowMs: 15 * 60 * 1000, limit: env.RATE_LIMIT_MAX, message: 'Too many requests. Please slow down.' });
// credential endpoints, per IP (the per-account lockout lives in authService)
export const authLimiter = make({ windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT_MAX, message: 'Too many attempts. Try again in a few minutes.' });
// write actions, per signed-in user
export const writeLimiter = make({ windowMs: 5 * 60 * 1000, limit: 200, message: "You're doing that a lot. Try again shortly.", keyByUser: true });
// content creation is stricter
export const createLimiter = make({ windowMs: 60 * 60 * 1000, limit: 60, message: 'Posting limit reached. Try again later.', keyByUser: true });
// chat is bursty but still bounded
export const messageLimiter = make({ windowMs: 60 * 1000, limit: 40, message: 'You are sending messages too quickly. Wait a moment.', keyByUser: true });
