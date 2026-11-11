// Netlify Functions entry for the Circle API. netlify.toml rewrites /api/* and /uploads/* to
// this function, so everything stays same-origin (cookies included). The exact Express app that
// runs locally (`npm run server`) is wrapped for serverless invocation, with a lazily created
// MongoDB connection that mongoose pools across warm invocations.
//
// Deliberately absent: Socket.IO (functions cannot hold WebSocket connections, so the client is
// built with VITE_REALTIME=false there) and the in-process job scheduler (see cleanup.js).
import serverless from 'serverless-http';
import { createApp } from '../../src/app.js';
import { connectDb } from '../../src/config/db.js';

let ready = null;
const ensureDb = () => {
  // If connecting fails, clear the promise so the next request retries instead of
  // caching a rejection for the lifetime of the warm instance.
  ready ??= connectDb().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
};

const app = createApp();
const run = serverless(app);

export const handler = async (event, context) => {
  await ensureDb();
  return run(event, context);
};
