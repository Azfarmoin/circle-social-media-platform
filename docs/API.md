# API reference

Base URL: `/api`. JSON in, JSON out. Errors always look like `{ "message": "…", "code": "SOME_CODE", "errors": [{ "field", "message" }] }`.

**Auth.** Send `Authorization: Bearer <accessToken>` on everything except the public auth routes. Access tokens last 15 minutes; renew with `POST /auth/refresh`, which uses an httpOnly `rt` cookie plus an `X-CSRF-Token` header that must equal the readable `csrf` cookie. Refresh tokens rotate on every use; replaying an old one revokes the whole session family.

**Pagination.** List endpoints take `?limit=` (1–30) and `?cursor=` and return `{ items, nextCursor }`. Pass `nextCursor` back as `cursor`; `null` means the end. Cursors are opaque.

**Rate limits.** Global 600 requests / 15 min per IP, auth routes 40 / 15 min, write requests 200 / 5 min per user, creating posts or comments 60 / hour. Responses carry `RateLimit-*` headers; exceeding a limit returns 429.

## Auth (`/auth`)
| Method & path | Purpose |
|---|---|
| `POST /register` | `{ username, email, password, name }`. Sends a verification email (development also returns `devVerifyUrl`). |
| `POST /verify-email` | `{ token }` |
| `POST /resend-verification` | `{ email }` (always answers 200) |
| `POST /login` | `{ identifier, password, otp?, remember? }` → `{ accessToken, user }` or `{ twoFactorRequired: true }`. 5 failures lock the account for 15 minutes. |
| `POST /refresh` | Rotates the refresh cookie → `{ accessToken, user }` |
| `POST /logout`, `POST /logout-all` | End this session / every session |
| `POST /forgot-password`, `POST /reset-password` | `{ email }` / `{ token, newPassword }` |
| `GET /me` | Current user |
| `POST /change-password` | `{ currentPassword, newPassword }`; signs out other devices |
| `GET /sessions`, `DELETE /sessions/:family` | List and revoke devices |
| `GET /login-history` | Recent sign-ins, including failures |
| `POST /2fa/setup`, `/2fa/enable`, `/2fa/disable` | TOTP set-up (`{ secret, otpauthUrl }`), enable with `{ code }` (returns 8 recovery codes), disable with `{ password, code }` |
| `POST /deactivate`, `DELETE /account` | `{ password }`. Delete removes all of the user's data. |

## Profiles and blocking
| | |
|---|---|
| `GET /profiles/:username` | Profile, about, relationship, counts. Respects privacy; 404 if blocked. |
| `PUT /profiles/me` | name, bio, website, location, relationshipStatus, birthday, languages, education[], work[] |
| `PUT /profiles/me/username` | `{ username }` |
| `POST /profiles/me/avatar`, `/cover` | multipart field `image` (JPEG/PNG/WebP/GIF, ≤ 5 MB) → `{ url }` |
| `DELETE /profiles/me/avatar`, `/cover` | |
| `GET`/`PUT /profiles/me/privacy` | profile/about/friend-list/birthday visibility, default post audience, who can send requests / follow / tag / comment |
| `PUT /profiles/me/notification-preferences` | per-type toggles |
| `GET /users/blocked?type=block\|restrict` | |
| `POST /users/:id/block` `{ type }`, `DELETE /users/:id/block` | Block or restrict; blocking removes friendship and follows |

## Friends and follows
`GET /friends`, `GET /friends/user/:id`, `GET /friends/suggestions`, `GET /friends/requests?direction=incoming|outgoing`, `POST /friends/requests/:userId` (send), `POST /friends/requests/:requestId/accept|reject`, `DELETE /friends/requests/:requestId` (cancel), `GET /friends/mutual/:userId`, `DELETE /friends/:userId` (unfriend). `POST|DELETE /follow/:userId`, `GET /follow/followers/:userId`, `GET /follow/following/:userId`.

## Posts
| | |
|---|---|
| `POST /posts` | multipart: `text`, `audience` (`public`\|`friends`\|`friends_except`\|`specific`\|`only_me`), `audienceList` (JSON array of user ids), `poll` (JSON `{question, options[2–6], multiple?, durationHours?}`), `feeling`, `location`, `tags` (JSON ids), up to 10 `images`. |
| `GET /posts/feed` | Friends, followed users and your own posts, newest first |
| `GET /posts/explore`, `/posts/trending` | Public posts |
| `GET /posts/user/:id?kind=all\|photos\|tagged`, `GET /posts/hashtag/:tag` | |
| `GET`/`PATCH`/`DELETE /posts/:id` | |
| `PUT /posts/:id/pin` `{pinned}` · `PUT`/`DELETE /posts/:id/save` · `POST /posts/:id/hide` · `POST /posts/:id/snooze` `{days}` | |
| `POST /posts/:id/vote` `{ options: [optionId] }` | Re-voting replaces the previous vote |
| `POST /posts/:id/share` | `{ text, audience }` |
| `GET /saved?collection=`, `GET /saved/collections` | |

## Comments and reactions
`GET|POST /comments/post/:postId` (`?sort=top\|newest\|oldest`; body `{ text, parentId? }`), `GET /comments/:id/replies`, `PATCH|DELETE /comments/:id`, `PUT /comments/:id/pin`. Replies are one level deep.

`PUT /reactions` `{ targetType: post\|comment, target, type: like\|love\|haha\|wow\|sad\|angry }` (one reaction per user per target; sending another type switches it), `DELETE /reactions?targetType=&target=`, `GET /reactions?targetType=&target=&type=` → `{ breakdown, items, nextCursor }`.

## Search, notifications, reports
`GET /search/people|posts|hashtags|suggest|trending|recent`, `POST|DELETE /search/recent`. `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read` `{ ids? }`, `DELETE /notifications/:id`. `POST /reports` `{ targetType: user\|post\|comment, target, category, details }`.

## Moderation (`/admin`, moderators and admins)
`GET /admin/stats`, `GET /admin/reports?status=`, `PATCH /admin/reports/:id` `{ status, removeContent? }`, `DELETE /admin/posts/:id`, `GET /admin/users?q=&status=&role=`, `PATCH /admin/users/:id` `{ action: suspend\|ban\|reinstate\|verify\|unverify\|set_role, role? }` (only admins can set roles), `GET /admin/audit-logs`. Every action is written to the audit log.

## Health
`GET /api/health` → `{ status, db, cache, uptime }`. No authentication.

## Realtime (Socket.IO)
Connect to the same origin with `io('/', { auth: { token: accessToken } })`. Server → client events: `notification`, `reaction:update`, `comment:new|update|delete|pin`, `poll:update`, `session:revoked`. Client → server: `post:join` / `post:leave` (postId; checked against the caller's visibility; at most 60 rooms per socket).


## Messages (`/api/messages`)

Direct messages between two people. Requires sign-in. Respects blocking and the recipient's
`whoCanMessage` setting (`everyone`, `friends`, `nobody`); read receipts respect `readReceipts`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/conversations` | Your chats, newest first (empty ones are hidden) |
| POST | `/conversations` `{ userId }` | Open or create the chat with a person |
| GET | `/conversations/:id` | One conversation |
| GET | `/conversations/:id/messages?cursor=&limit=` | Messages, newest first, cursor paginated |
| POST | `/conversations/:id/messages` `{ text }` | Send (1-2000 characters, 40 per minute) |
| POST | `/conversations/:id/read` | Mark everything read |
| GET | `/unread-count` | Total unread messages |
| DELETE | `/:id` | Unsend your own message |

Socket events: `message:new`, `message:read`, `message:read:self`, `message:delete`.
