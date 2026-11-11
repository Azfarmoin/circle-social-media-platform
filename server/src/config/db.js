import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

/** Hides the password in a connection string so it is safe to print or log. */
export const redactUri = (uri = '') => uri.replace(/(\/\/[^:/@]+:)([^@]*)(@)/, '$1****$3');

const isAtlas = (uri) => /^mongodb\+srv:\/\//.test(uri) || /\.mongodb\.net/.test(uri);

/** Turns the driver's raw error into something a person can act on. */
export function explainDbError(err, uri = '') {
  const msg = String(err?.message || err);
  if (/bad auth|authentication failed|AuthenticationFailed/i.test(msg)) {
    return 'MongoDB rejected the username or password. In Atlas open Database Access, check the user and password, and URL-encode special characters in the password (@ becomes %40, # becomes %23, / becomes %2F).';
  }
  if (/ENOTFOUND|querySrv|EREFUSED.*_mongodb/i.test(msg)) {
    return 'The cluster address could not be resolved. Copy the connection string again from Atlas (Connect > Drivers) and check for typos, and make sure your network allows DNS lookups.';
  }
  if (/Server selection timed out|ReplicaSetNoPrimary|ETIMEDOUT|ECONNREFUSED|getaddrinfo/i.test(msg)) {
    return isAtlas(uri)
      ? 'Could not reach the Atlas cluster. Most often your current IP address is not allowed: in Atlas open Network Access and add your IP (or 0.0.0.0/0 while testing). Also check the cluster is not paused and that your network is not blocking port 27017.'
      : 'Could not reach MongoDB. Is it running, and is MONGO_URI correct?';
  }
  if (/Invalid scheme|Invalid connection string|must be of the form|URI malformed/i.test(msg)) {
    return 'MONGO_URI is not a valid MongoDB connection string. It should start with mongodb:// or mongodb+srv:// and have no spaces or angle brackets (remove the < > around <password>).';
  }
  return msg;
}

function warnAboutUri(uri) {
  if (/[<>]/.test(uri)) logger.warn('MONGO_URI still contains < > placeholders. Replace <password> with the real password, without the brackets.');
  const dbName = uri.replace(/^mongodb(\+srv)?:\/\/[^/]*\/?/, '').split('?')[0];
  if (!dbName) logger.warn('MONGO_URI has no database name, so MongoDB will use "test". Add one, e.g. ...mongodb.net/circle?retryWrites=true&w=majority');
}

/**
 * Connects with retries. Atlas clusters can take a few seconds to answer the first time
 * (and free clusters wake from sleep), so a short retry loop avoids spurious start-up failures.
 */
export async function connectDb(uri = env.MONGO_URI, { attempts = env.isTest ? 1 : 4 } = {}) {
  warnAboutUri(uri);
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: isAtlas(uri) ? 20000 : 8000, maxPoolSize: 20, retryWrites: true });
      const { host, name } = mongoose.connection;
      logger.info({ host, db: name, atlas: isAtlas(uri) }, 'MongoDB connected');
      return mongoose.connection;
    } catch (err) {
      lastErr = err;
      const hint = explainDbError(err, uri);
      logger.error({ attempt: i, of: attempts, uri: redactUri(uri) }, `MongoDB connection failed: ${hint}`);
      // credentials and syntax problems will not fix themselves, so do not keep retrying
      if (/auth|Invalid|malformed/i.test(String(err.message))) break;
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  const e = new Error(explainDbError(lastErr, uri));
  e.cause = lastErr;
  throw e;
}

mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected; the driver will keep trying to reconnect'));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

export async function disconnectDb() {
  await mongoose.disconnect();
}

export const dbState = () =>
  ({ 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' })[mongoose.connection.readyState] || 'unknown';
