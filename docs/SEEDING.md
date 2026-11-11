# Seed data

```bash
npm run seed -- --reset        # from the repo root; or: cd server && node src/seeds/seed.js --reset
```

Creates 39 users, 238 friendships, 542 follows, 131 posts (6 polls, about a third with images), 203 comments with replies, 537 reactions, 191 notifications and 30 hashtags. The generator is deterministic, so every run produces the same people and posts. Seed images are small generated SVGs written to the upload directory.

| Account | Email | Role |
|---|---|---|
| Demo user | `demo@circle.test` | user (friends with ~19 seeded people, has requests and notifications waiting) |
| Admin | `admin@circle.test` | admin |
| Moderator | `moderator@circle.test` | moderator |

Every seeded account uses the password `Password123!`. Seeded users are already email-verified.

## Automatic seeding
On hosts without a shell (Render's free plan) set `AUTO_SEED=true`. When the server starts and the database has no users, it builds the demo network first; if there are any users it does nothing, so real accounts are never touched or duplicated. The Render blueprint and Docker Compose enable it by default so a fresh deployment is not empty; set it to `false` (or delete the variable) for a real site, and delete the demo accounts if you used it.

`--reset` deletes existing data first. Without it the seed adds to what is there. The script refuses to run when `NODE_ENV=production` unless you pass `--force`; never seed a real production database.
