# Environment variables

All variables are read by the server (`server/src/config/env.js`). Copy `server/.env.example` to `server/.env` for local work. In production (`NODE_ENV=production`) a missing **required** variable stops the server at start-up instead of falling back to an insecure default.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production`, `test` |
| `PORT` | `5000` | |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/circle` | |
| `REDIS_URL` | empty | Optional. Empty = in-memory cache. |
| `CLIENT_URL` | `RENDER_EXTERNAL_URL`, else `PUBLIC_URL`, else `http://localhost:5173` | The public address of the site. Used for CORS, Socket.IO and links in emails |
| `CLIENT_DIST` | `client/dist` | Built web app. If this folder exists the server serves the site itself |
| `TRUST_PROXY` | `true` in production | Needed behind nginx / a load balancer |
| `JWT_ACCESS_SECRET` | dev placeholder | **Required in production.** `openssl rand -hex 48` |
| `ACCESS_TTL_SEC` | `900` | |
| `REFRESH_TTL_DAYS` / `REFRESH_TTL_REMEMBER_DAYS` | `7` / `30` | |
| `COOKIE_SECURE` | `true` in production | Must be `false` for plain-HTTP deployments |
| `BCRYPT_ROUNDS` | `12` (`4` in tests) | |
| `MAX_LOGIN_ATTEMPTS`, `LOCK_MINUTES` | `5`, `15` | Account lock-out |
| `REQUIRE_EMAIL_VERIFICATION` | `true` (production: only if `SMTP_URL` is set) | |
| `RATE_LIMIT_DISABLED` | `false` (`true` in tests) | Turn on for e2e runs only |
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX` | `600`, `40` | Per IP per 15 minutes |
| `AUTO_SEED` | `false` | `true` fills an *empty* database with the demo data at start-up (see docs/SEEDING.md). Does nothing once any user exists |
| `UPLOAD_DIR` | `server/uploads` | Persist this directory (a volume in Docker) |
| `PUBLIC_BASE_URL` | empty | Prefix for uploaded-file URLs if served from a CDN |
| `SMTP_URL` | empty | e.g. `smtps://user:pass@smtp.example.com`. Empty = in-memory outbox |
| `MAIL_FROM` | `Circle <no-reply@circle.local>` | |
| `LOG_LEVEL` | `info` | |

Client: `VITE_API_TARGET` (dev proxy target, default `http://localhost:5000`).
Tests: `TEST_MONGO_URI` (server tests create a throw-away database per file on this server), `E2E_BASE_URL`, `CHROMIUM_PATH` (e2e).
