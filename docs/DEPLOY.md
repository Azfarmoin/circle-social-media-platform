# Deployment

Circle deploys as **one service**: the Node server also serves the built web app, so there is a single URL, no CORS setup and no separate front-end host. All you need besides the server is a MongoDB database (MongoDB Atlas has a free tier).

## Option A: Render (easiest, free plan available)

1. Push this project to a GitHub repository.
2. Create a free MongoDB Atlas cluster and get the connection string (see the README, *Using MongoDB Atlas*). Under **Network Access** allow `0.0.0.0/0`, because Render's addresses change.
3. In Render: **New > Blueprint**, choose your repository. `render.yaml` sets everything up and asks you for one value, `MONGO_URI` (your Atlas string ending in `/circle?retryWrites=true&w=majority`). The secret key is generated for you.
4. Wait for the build (a few minutes) and open the URL Render gives you. Check `https://YOUR-APP.onrender.com/api/health`; it should say `"db":"connected"`.
5. Demo data: the blueprint sets `AUTO_SEED=true`, so the first start fills the empty database with 39 demo people and 130 posts. Sign in as `demo@circle.test` / `Password123!`. For a real site, set `AUTO_SEED` to `false` and remove the demo accounts (or use a fresh database).

Free-plan limits to know about: the service sleeps after ~15 minutes without traffic (the first visit then takes about a minute), and **uploaded photos are lost on restart** because the free plan has no disk. For real use choose a paid plan, add a disk mounted at `/data/uploads` and set `UPLOAD_DIR=/data/uploads`.

## Option B: Any Docker host (VPS, Fly.io, Railway, Azure, your own server)

```bash
docker compose up --build -d        # site on http://localhost:8080 with its own MongoDB and demo data
```
To use Atlas instead of the bundled database, copy `.env.example` to `.env`, fill in `MONGO_URI`, and run `docker compose up --build -d app`. To run the image on its own:

```bash
docker build -t circle .
docker run -d -p 80:5000 --restart unless-stopped \
  -e MONGO_URI='mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/circle?retryWrites=true&w=majority' \
  -e JWT_ACCESS_SECRET="$(openssl rand -hex 48)" \
  -e CLIENT_URL=https://your.domain -e COOKIE_SECURE=true \
  -v circle-uploads:/data/uploads circle
```
Put HTTPS in front (Caddy, Traefik, Cloudflare, or the platform's built-in TLS) and keep `COOKIE_SECURE=true`. Behind plain HTTP, set it to `false` or login cookies will not be stored.

## Option C: Plain Node (no Docker)

```bash
npm run build:all                                    # installs and builds the web app
NODE_ENV=production MONGO_URI=... JWT_ACCESS_SECRET=... CLIENT_URL=https://your.domain npm start
```
Works on any platform that runs `npm run build:all` then `npm start` (Heroku-style hosts, Railway, a VPS with pm2 or systemd). Node 18 or newer.

## Option D: Netlify (serverless, all-in-one)

The whole site runs on Netlify: the web app is served from the CDN, the API is a Netlify
Function wrapping the same Express app, and uploads are stored in Netlify Blobs.

1. Push this repository to GitHub, then in Netlify **Add new site > Import an existing project**.
   `netlify.toml` takes care of the build, the functions and the redirects.
2. Set the environment variables (Site configuration > Environment variables):
   `MONGO_URI` (your Atlas string), `JWT_ACCESS_SECRET` (long random value),
   `CLIENT_URL` and `PUBLIC_BASE_URL` (your `https://<site>.netlify.app` URL),
   `STORAGE_DRIVER=netlify-blobs`, `VITE_REALTIME=false`, `AUTO_SEED=false`.
   `COOKIE_SECURE` and `TRUST_PROXY` default to `true` in production.
3. Deploy, then check `https://<site>.netlify.app/api/health` says `"db":"connected"`.
4. One-off, so the demo avatars/post images render: push the seeded images to Blobs with
   `NETLIFY_SITE_ID=<project id> NETLIFY_AUTH_TOKEN=<token> npm run blobs:seed`.

**Trade-offs (serverless platform limits):** no realtime — Socket.IO cannot hold WebSocket
connections in functions, so the client is built with `VITE_REALTIME=false` and new
notifications/messages appear on refresh instead of instantly; uploads are capped at 4 MB
(function request-body limit); background cleanup runs on a 6-hour schedule instead of
in-process; in-memory rate limiting and cache counters are per-instance.

## Before you tell anyone the address
- `/api/health` reports `"db":"connected"`.
- `JWT_ACCESS_SECRET` is your own long random value (the compose default is only for trials).
- **Email:** without `SMTP_URL` no email can be sent, so in production new accounts are active immediately and *Forgot password* cannot send links. Set `SMTP_URL` (any SMTP provider) to turn on email verification and resets.
- Atlas Network Access allows your server, and the Atlas user has a strong password.

## Operating notes
- Backups: use Atlas backups (paid tiers) or `mongodump`, and back up the uploads folder with it.
- Several instances: set `REDIS_URL` so the relationship cache is shared. Rate-limit counters are per instance, and Socket.IO needs sticky sessions (or the Redis adapter, not included) across instances.
- Uploads live on disk. For several instances use shared storage or swap `uploadService` for an object store.
- `/api/health` works for liveness and readiness checks.
