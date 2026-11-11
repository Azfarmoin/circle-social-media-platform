import 'express-async-errors';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import fs from 'fs';
import path from 'path';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { dbState } from './config/db.js';
import { cache } from './config/cache.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import { uploads, safeRel } from './services/uploadService.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(pinoHttp({ logger, genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(), autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(cors({ origin: env.CLIENT_URL, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'] }));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  // strips `$`-prefixed and dotted keys from body/query/params so operators cannot be injected
  app.use(mongoSanitize({ replaceWith: '_' }));
  app.use(globalLimiter);

  app.get('/api/health', (_req, res) => {
    const db = dbState();
    res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', db, cache: cache.kind, uptime: Math.round(process.uptime()) });
  });

  // Uploaded images. Disk-backed hosts stream them straight from UPLOAD_DIR; serverless hosts
  // (no filesystem) serve them from Netlify Blobs with the same cache and security headers.
  if (uploads.kind === 'netlify-blobs') {
    app.get('/uploads/*', async (req, res, next) => {
      try {
        const rel = safeRel(decodeURIComponent(req.path.replace(/^\/uploads\//, '')));
        const buffer = rel ? await uploads.get(rel) : null;
        if (!buffer) return next(); // a missing file is a 404
        res.set('Cache-Control', 'public, max-age=604800, immutable');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        res.type(path.extname(rel) || 'bin');
        res.send(buffer);
      } catch {
        next();
      }
    });
  } else {
    app.use(
      '/uploads',
      express.static(env.UPLOAD_DIR, {
        maxAge: '7d',
        immutable: true,
        index: false,
        dotfiles: 'deny',
        setHeaders: (res) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        },
      })
    );
  }

  app.use('/api', routes);

  // One-service deployment: serve the built web app (and its client-side routes) from the same origin as the API.
  const indexFile = path.join(env.CLIENT_DIST, 'index.html');
  if (fs.existsSync(indexFile)) {
    const pageCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    app.use(express.static(env.CLIENT_DIST, {
      index: false, dotfiles: 'deny',
      setHeaders: (res, file) => {
        res.setHeader('Content-Security-Policy', pageCsp);
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^\/(?!api\/|uploads\/|socket\.io\/).*/, (req, res, next) => {
      if (path.extname(req.path)) return next(); // a missing file is a 404, not the app shell
      res.setHeader('Content-Security-Policy', pageCsp);
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
    logger.info({ dir: env.CLIENT_DIST }, 'Serving the web app');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
