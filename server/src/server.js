import http from 'http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { cache } from './config/cache.js';
import { createApp } from './app.js';
import { initSocket } from './sockets/index.js';
import { startJobs } from './jobs/index.js';
import { User } from './models/index.js';

async function main() {
  await connectDb();
  if (env.AUTO_SEED && !(await User.estimatedDocumentCount())) {
    // only ever into an empty database, so real accounts are never touched or duplicated
    const { seedDemo } = await import('./seeds/seed.js');
    await seedDemo({ force: true, log: (m) => logger.info(m) });
  }
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  const stopJobs = startJobs();

  server.listen(env.PORT, () => logger.info(`Circle API listening on :${env.PORT} (${env.NODE_ENV})`));

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    stopJobs();
    server.close(async () => {
      await disconnectDb();
      await cache.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
