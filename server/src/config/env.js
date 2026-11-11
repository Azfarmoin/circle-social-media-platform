import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const e = process.env;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodeEnv = e.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const required = (key, devDefault) => {
  if (e[key]) return e[key];
  if (isProd) throw new Error(`Missing required environment variable: ${key}`);
  return devDefault;
};

const bool = (v, fallback) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1');

export const env = {
  NODE_ENV: nodeEnv,
  isProd,
  isTest,
  isDev: nodeEnv === 'development',

  PORT: Number(e.PORT || 5000),
  MONGO_URI: e.MONGO_URI || 'mongodb://127.0.0.1:27017/circle',
  REDIS_URL: e.REDIS_URL || '',
  // Public address of the site. Hosting platforms usually provide it (Render sets RENDER_EXTERNAL_URL).
  CLIENT_URL: (e.CLIENT_URL || e.RENDER_EXTERNAL_URL || e.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Folder holding the built web app. When it exists the API serves it too, so one service is the whole site.
  CLIENT_DIST: e.CLIENT_DIST ? path.resolve(e.CLIENT_DIST) : path.resolve(__dirname, '..', '..', '..', 'client', 'dist'),
  TRUST_PROXY: bool(e.TRUST_PROXY, isProd),

  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me-please'),
  ACCESS_TTL_SEC: Number(e.ACCESS_TTL_SEC || 900),
  REFRESH_TTL_DAYS: Number(e.REFRESH_TTL_DAYS || 7),
  REFRESH_TTL_REMEMBER_DAYS: Number(e.REFRESH_TTL_REMEMBER_DAYS || 30),

  COOKIE_SECURE: bool(e.COOKIE_SECURE, isProd),
  BCRYPT_ROUNDS: Number(e.BCRYPT_ROUNDS || (isTest ? 4 : 12)),
  MAX_LOGIN_ATTEMPTS: Number(e.MAX_LOGIN_ATTEMPTS || 5),
  LOCK_MINUTES: Number(e.LOCK_MINUTES || 15),
  // Without a mail server nobody could ever verify, so in production this defaults to on only when SMTP_URL is set.
  REQUIRE_EMAIL_VERIFICATION: bool(e.REQUIRE_EMAIL_VERIFICATION, isProd ? !!e.SMTP_URL : true),

  RATE_LIMIT_DISABLED: bool(e.RATE_LIMIT_DISABLED, isTest),
  RATE_LIMIT_MAX: Number(e.RATE_LIMIT_MAX || 600),
  AUTH_RATE_LIMIT_MAX: Number(e.AUTH_RATE_LIMIT_MAX || 40),

  // Fills an EMPTY database with demo people and posts at start-up. Handy on hosts with no shell (Render free plan).
  AUTO_SEED: bool(e.AUTO_SEED, false),

  UPLOAD_DIR: e.UPLOAD_DIR ? path.resolve(e.UPLOAD_DIR) : path.resolve(__dirname, '..', '..', 'uploads'),
  PUBLIC_BASE_URL: e.PUBLIC_BASE_URL || '',
  // Where uploaded images live: plain local disk by default, or Netlify Blobs on serverless
  // hosts, which have no writable/persistent filesystem. Set STORAGE_DRIVER=netlify-blobs
  // there (auto-detected when Netlify's own NETLIFY env var is present).
  STORAGE_DRIVER: e.STORAGE_DRIVER || (e.NETLIFY ? 'netlify-blobs' : 'disk'),

  SMTP_URL: e.SMTP_URL || '',
  MAIL_FROM: e.MAIL_FROM || 'Circle <no-reply@circle.local>',

  LOG_LEVEL: e.LOG_LEVEL || (isTest ? 'silent' : 'info'),
};
