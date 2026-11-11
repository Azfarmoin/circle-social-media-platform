// One-off: pushes the seeded demo images (server/uploads/seed/**) into the Netlify Blobs
// store used by the deployed site, so demo avatars and post images render in production.
//
//   NETLIFY_SITE_ID=<project id> NETLIFY_AUTH_TOKEN=<personal access token> npm run blobs:seed --prefix server
//
// - Project ID: Netlify UI > Project configuration > General > Project information.
// - Token: https://app.netlify.com/user/applications (Personal access tokens).
// Safe to re-run: existing keys are simply overwritten with the same content.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'uploads', 'seed');

const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
if (!siteID || !token) {
  console.error('Set NETLIFY_SITE_ID (Netlify Project ID) and NETLIFY_AUTH_TOKEN (personal access token) first.');
  process.exit(1);
}
if (!(await fs.stat(seedDir).catch(() => null))) {
  console.error(`No seed images found at ${seedDir}. Run "npm run seed --prefix server" first.`);
  process.exit(1);
}

const store = getStore('circle-uploads', { siteID, token });
const files = await fs.readdir(seedDir, { recursive: true, withFileTypes: true });

let count = 0;
for (const entry of files) {
  if (!entry.isFile()) continue;
  const rel = path.posix.join(entry.parentPath === '.' ? '' : entry.parentPath, entry.name);
  const buffer = await fs.readFile(path.join(seedDir, rel));
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await store.set(`seed/${rel}`, ab);
  count += 1;
  console.log(`seed/${rel}`);
}

console.log(`\nDone: ${count} seed images are now in the "circle-uploads" Blobs store.`);
