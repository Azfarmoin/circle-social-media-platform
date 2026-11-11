# Architecture and security notes

## Shape
Browser ⇄ (same origin) Express API, which also serves the built web app (in development the Vite proxy forwards to it) ⇄ MongoDB (+ optional Redis). Socket.IO shares the API's HTTP server. The server is layered: **routes** (wiring and validation) → **controllers** (HTTP only) → **services** (all business rules) → **models**. Controllers never touch the database directly, so rules such as privacy are enforced in one place.

## Authentication
- Short-lived access JWT (15 min) kept only in client memory; never in localStorage.
- Opaque refresh token in an httpOnly, SameSite=Strict cookie scoped to `/api/auth`. Only its SHA-256 hash is stored. Every use rotates it; presenting an already-rotated token revokes the whole token family (theft detection). Rotation is an atomic compare-and-set so two tabs refreshing at once cannot both win.
- Cookie-authenticated routes (`refresh`, `logout`) additionally require the double-submit `X-CSRF-Token` header.
- Passwords: bcrypt, strength rules, lock-out after repeated failures, generic "incorrect email/username or password" messages, new-device alerts, 2FA with hashed single-use recovery codes.

## Privacy model
A single `visibility` module builds the MongoDB filter for "what may this viewer see" from the viewer's cached relationships (friends, follows, blocks, restrictions). Feed, profile, search, comments, reactions, hashtag pages, notifications and socket room joins all go through it, so audience rules (`public`, `friends`, `friends_except`, `specific`, `only_me`) and blocking behave identically everywhere. Counters are denormalised and updated with `$inc`; poll tallies and hashtag counts too.

## Input and output safety
zod validation on every body, query and param (ids, lengths, enums, caps on list sizes); NoSQL operator injection is rejected by validation and `express-mongo-sanitize`; user text is stripped of markup on write and rendered by React as text (no `innerHTML`); uploads are limited to 5 MB, identified by magic bytes (the client-supplied type is ignored), renamed randomly, and served with `nosniff` and a sandboxing CSP; there is a `scanBuffer` hook for an antivirus engine. Helmet sets a strict CSP, HSTS and friends; CORS allows only `CLIENT_URL`.

## Realtime
Each socket authenticates with the access token and is tied to its session family, so revoking a session disconnects it. Rooms: `user:<id>` for notifications, `post:<id>` for live counters (join is visibility-checked and capped at 60 rooms). The client joins a post's room only while the card is near the viewport.

## Known limitations
- Tested against FerretDB in the development sandbox; run the suite against real MongoDB (CI does) before relying on it. One test (many simultaneous reactions) is skipped on FerretDB because it loses concurrent `$inc` updates, which MongoDB does not.
- The composer has no "tag friends" picker yet (the API and Tagged tab support tags).
- The 2FA set-up screen shows the secret and an `otpauth://` link rather than a QR code.
- No virus scanner is bundled (the hook is there), no image resizing, and uploads are local disk.
- Rate-limit counters are per instance; Socket.IO is single-instance unless you add the Redis adapter.


## Messaging, presence and typing

Conversations are one per pair of people (`pair` is a unique sorted key). Typing indicators and online status are in memory and relayed over Socket.IO, so they are single-instance like the rest of the realtime layer; scale out with the Socket.IO Redis adapter. Message photos go through the same upload pipeline as post photos (type sniffing, sharp re-encode, random names) and are deleted from disk when a message is unsent or an account is deleted.
