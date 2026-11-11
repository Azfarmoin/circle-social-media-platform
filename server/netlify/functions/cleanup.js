// Scheduled replacement for the in-process job interval (serverless functions cannot host
// timers): runs the database cleanup - expired sessions and tokens, old notifications and login
// events - every six hours, exactly like `startJobs()` does on a long-running server.
import { connectDb, disconnectDb } from '../../src/config/db.js';
import { cleanupExpired } from '../../src/jobs/index.js';

export default async () => {
  await connectDb();
  const summary = await cleanupExpired();
  await disconnectDb();
  return new Response(JSON.stringify({ ok: true, summary }), { headers: { 'content-type': 'application/json' } });
};

export const config = { schedule: '0 */6 * * *' };
