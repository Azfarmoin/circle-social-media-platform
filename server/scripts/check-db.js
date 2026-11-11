// Verifies the MongoDB connection (local or Atlas) and that the app can read and write.
// Usage: npm run db:check
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDb, disconnectDb, redactUri } from '../src/config/db.js';

console.log(`Checking ${redactUri(env.MONGO_URI)} ...`);
try {
  await connectDb(env.MONGO_URI, { attempts: 1 });
  const db = mongoose.connection.db;
  const info = await db.admin().command({ buildInfo: 1 }).catch(() => ({}));
  console.log(`Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host} (MongoDB ${info.version || 'unknown'})`);
  const probe = db.collection('_connection_check');
  const { insertedId } = await probe.insertOne({ at: new Date() });
  const found = await probe.findOne({ _id: insertedId });
  await probe.drop().catch(() => {});
  if (!found) throw new Error('Wrote a test document but could not read it back');
  console.log('Read and write both work. The database is ready.');
  await disconnectDb();
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  process.exitCode = 1;
  await disconnectDb().catch(() => {});
}
