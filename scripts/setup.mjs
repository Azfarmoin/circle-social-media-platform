// Guided local setup:  npm run setup
// Installs dependencies, writes server/.env (with fresh random secrets), checks the MongoDB connection and offers demo data.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'server', '.env');
const rl = readline.createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
const run = (cmd, args, cwd = root, env = {}) => spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } }).status === 0;
// reads one line at a time from a queue, so it behaves the same typed in a terminal or piped from a file
const ask = async (q, d = '') => {
  process.stdout.write(d ? `${q} [${d}] ` : `${q} `);
  const { value, done } = await lines.next();
  if (done) process.stdout.write('\n');
  return (done ? '' : value).trim() || d;
};

console.log('\nCircle setup\n');
if (Number(process.versions.node.split('.')[0]) < 18) { console.error('Node 18 or newer is required.'); process.exit(1); }

console.log('1/4 Installing dependencies...');
if (!run('npm', ['run', 'install:all'])) { console.error('Install failed.'); process.exit(1); }

console.log('\n2/4 Database');
let uri = 'mongodb://127.0.0.1:27017/circle';
const choice = await ask('Use (1) MongoDB Atlas (cloud) or (2) MongoDB on this computer?', '1');
if (choice === '1') {
  console.log('In Atlas: Database > Connect > Drivers > copy the string. Replace <password>, and add /circle after the host.');
  uri = await ask('Paste your connection string:');
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) { console.error('That does not look like a MongoDB connection string.'); process.exit(1); }
}

console.log('\n3/4 Writing server/.env');
if (existsSync(envFile) && (await ask('server/.env already exists. Overwrite? (y/N)', 'n')).toLowerCase() !== 'y') {
  console.log('Keeping your existing server/.env');
} else {
  writeFileSync(envFile, `NODE_ENV=development\nPORT=5000\nMONGO_URI=${uri}\nCLIENT_URL=http://localhost:5173\nJWT_ACCESS_SECRET=${randomBytes(48).toString('hex')}\n`, { mode: 0o600 });
}

console.log('\n4/4 Checking the database connection');
const ok = run('npm', ['run', 'db:check'], path.join(root, 'server'));
if (!ok) { console.error('\nFix the problem above, then run npm run setup again (or edit server/.env and run npm run db:check --prefix server).'); rl.close(); process.exit(1); }

if ((await ask('\nAdd demo data (39 users, 130 posts)? (Y/n)', 'y')).toLowerCase() === 'y') run('npm', ['run', 'seed', '--', '--reset']);
rl.close();
console.log('\nAll set. Start the site with two terminals:\n  npm run server\n  npm run client\nthen open http://localhost:5173  (demo login: demo@circle.test / Password123!)\n');
