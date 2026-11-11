# Circle

A full-stack social network: sign up, build a profile, make friends, post with audiences and polls, react with six reactions, comment in threads, and get live notifications. React + Redux Toolkit + Tailwind on the front, Node + Express + MongoDB + Socket.IO on the back.

> Circle is an original product. It borrows common social-network ideas but none of any existing platform's branding.

![Circle home feed](docs/screenshots/home.png)

<table>
  <tr>
    <td><img src="docs/screenshots/messages.png" alt="Messages" /></td>
    <td><img src="docs/screenshots/about.png" alt="About page" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dark.png" alt="Dark mode" /></td>
    <td><img src="docs/screenshots/mobile.png" alt="Mobile layout" width="260" /></td>
  </tr>
</table>

## How it fits together

```mermaid
flowchart LR
  B[Browser<br/>React + Redux + Tailwind] -- REST + JWT --> A[Express API]
  B -- Socket.IO --> A
  A --> M[(MongoDB / Atlas)]
  A --> U[/Image uploads<br/>re-encoded with sharp/]
  A -. optional .-> R[(Redis cache)]
  subgraph API layers
    direction TB
    RT[routes + zod validation] --> C[controllers] --> S[services] --> MD[Mongoose models]
  end
```

Access tokens live in memory and last 15 minutes. A rotating refresh token sits in an httpOnly cookie, and reusing an old one revokes the whole session family. Realtime events (notifications, reactions, comments, polls, messages, typing, presence) travel over Socket.IO rooms. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's in this version (Phase 1)

| Area | Included |
|---|---|
| **Accounts** | Register, email verification, login, refresh-token rotation with reuse detection, logout / logout everywhere, forgot & reset password, change password, account lock-out, TOTP two-factor with recovery codes, session list with remote sign-out, login history, deactivate and permanently delete |
| **Profiles** | Avatar and cover upload, bio, work, education, location, links, languages, relationship status, birthday, per-field privacy, username change, posts / about / friends / photos / tagged tabs |
| **Friends** | Requests (send, accept, decline, cancel), unfriend, follow / unfollow, mutual friends, suggestions, block and restrict |
| **Posts** | Text, multi-photo upload (drag and drop), polls (single or multiple choice, expiry), feelings, locations, #hashtags and @mentions, audiences *Public / Friends / Friends except… / Specific friends / Only me*, edit, delete, pin, save to collections, hide, snooze an author, share, report |
| **Feed** | Cursor-paginated infinite scroll, explore, trending, hashtag pages, search for people, posts and tags |
| **Messages** | One-to-one chat with live delivery, typing indicator, online status, photos, emoji, unread badge, read receipts (can be turned off), unsend, and privacy controls (who can message you, who sees you online, blocking) |
| **About page** | Every profile has an About page at `/u/<username>/about`: overview, connections, work, education and basic info, each respecting privacy settings |
| **Engagement** | Like, Love, Haha, Wow, Sad, Angry on posts and comments; threaded comments with edit, delete, pin, sort (top / newest / oldest); who-reacted list |
| **Realtime** | Notifications, live reaction / comment / poll counters, instant sign-out when a session is revoked |
| **Moderation** | Moderator console: stats, report queue, user suspend / ban / verify / roles, audit log |
| **UI** | Responsive (sidebar on desktop, bottom bar on mobile), light / dark / system theme, skeleton loaders, empty and error states, toasts, keyboard and screen-reader support |
| **Performance** | Routes are code-split (the first load is about 50 KB of app code plus cached vendor chunks), uploads are re-encoded with sharp (EXIF and GPS stripped, capped at 2048 px), gzip, immutable asset caching, an offline banner |
| **Quality** | 132 API tests, 26 client tests, 7 browser end-to-end tests, Docker Compose, GitHub Actions CI, `npm audit` clean |

**Not built (out of Phase 1):** Stories, Reels, group chats, Groups, Pages, Events, Marketplace, live video, calls, ads, monetisation and AI features. See [Roadmap](#roadmap).

## Quick start

Requirements: Node 18+ (22 recommended). A MongoDB database: either a free MongoDB Atlas cluster or MongoDB installed locally.

```bash
npm run setup
```
The guided setup installs everything, asks for your MongoDB connection string, writes `server/.env` with fresh secrets, tests the connection and can load demo data. Then, in two terminals:

```bash
npm run server     # API on :5000
npm run client     # web app on :5173
```
Open http://localhost:5173 and sign in as `demo@circle.test` / `Password123!` (more accounts in [docs/SEEDING.md](docs/SEEDING.md)). In development, new registrations show an "Open your verification link" button instead of sending email.

Prefer to do it by hand? `npm run install:all`, copy `server/.env.example` to `server/.env`, set `MONGO_URI`, run `npm run db:check` and `npm run seed -- --reset`.

## Deploy it
One service serves the API and the web app. The easiest route is **Render**: push to GitHub, choose *New > Blueprint*, paste your Atlas `MONGO_URI`; the first start loads demo data automatically. Docker and plain-Node routes are in [docs/DEPLOY.md](docs/DEPLOY.md). Locally with Docker: `docker compose up --build`, then http://localhost:8080.

### Using MongoDB Atlas (cloud cluster)

1. In Atlas, create a free cluster (for example `Cluster0`).
2. **Database Access** > Add New Database User > username and password > role *Read and write to any database*.
3. **Network Access** > Add IP Address > *Add Current IP Address* (or `0.0.0.0/0` while testing). *This is the most common reason a connection fails.*
4. **Database** > Connect > *Drivers* > copy the connection string. It looks like `mongodb+srv://USER:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
5. Put it in `server/.env`, replacing `<password>` with your real password (no `< >`; URL-encode special characters, e.g. `@` becomes `%40`) and **adding the database name** after the host:
   ```
   MONGO_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/circle?retryWrites=true&w=majority
   ```
6. Check it: `npm run db:check --prefix server`. It prints the cluster, the database and whether reads and writes work, or a plain-English reason it failed.
7. Optional demo data: `npm run seed -- --reset`, then `npm run server` and `npm run client`.

Never commit `server/.env` (it is git-ignored) and never share the connection string; if it leaks, change the database user's password in Atlas.

## Scripts

| Command | |
|---|---|
| `npm test` | API tests then client tests |
| `npm run e2e` | Browser tests (needs the API and client running with `RATE_LIMIT_DISABLED=true`; see below) |
| `npm run setup` | Guided local setup (dependencies, `.env`, database check, demo data) |
| `npm run db:check` | Test the MongoDB connection |
| `npm run seed` | Seed demo data |
| `npm run build` | Production client build |

**API tests** (`server/tests`) spin up the real Express app against a throw-away database per file. Set `TEST_MONGO_URI` (default `mongodb://127.0.0.1:27017`).
**E2E** (`client/e2e`): start MongoDB, `RATE_LIMIT_DISABLED=true npm run server`, `npm run client`, then `npm run e2e` (install a browser once with `npx playwright install chromium`, or point `CHROMIUM_PATH` at one).

## Project layout
```
client/   React app (src/pages, src/components, src/store, src/api, src/lib) + tests/ (vitest) + e2e/ (Playwright)
server/   Express API: config, models, validators, middleware, controllers, services, routes, sockets, jobs, seeds, tests
shared/   constants used by both sides (reactions, audiences, limits)
Dockerfile, docker-compose.yml, render.yaml   deployment (one image serves API + web app)
scripts/  guided setup
docs/     API.md, ENVIRONMENT.md, SEEDING.md, DEPLOY.md, ARCHITECTURE.md
```
The moderator console is part of the client (`/admin`, role-gated) rather than a separate app.

## Documentation
[API reference](docs/API.md) · [Environment variables](docs/ENVIRONMENT.md) · [Seeding](docs/SEEDING.md) · [Deployment](docs/DEPLOY.md) · [Architecture and security](docs/ARCHITECTURE.md)

## Roadmap
Natural next phases, each reusing the existing auth, privacy and notification layers: direct messages (Socket.IO rooms already exist), groups and pages, stories, events, then media processing (thumbnails, video) with object storage.
