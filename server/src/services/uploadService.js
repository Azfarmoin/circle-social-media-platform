// Image upload pipeline: size limits (multer) -> real file-type sniffing -> random server-side name.
// The client-supplied filename and Content-Type are never trusted. Storage is pluggable behind
// the `uploads` driver: plain local disk by default, or Netlify Blobs for serverless deploys,
// which have no writable filesystem. Swap in S3 / Cloudinary the same way without touching callers.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { badRequest } from '../utils/AppError.js';

const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

export const detectImage = (buffer) => SIGNATURES.find((s) => s.test(buffer)) || null;

// Hook point for an antivirus engine (e.g. ClamAV over TCP). Throw to reject the upload.
export async function scanBuffer(/* buffer */) {
  return true;
}

// --- storage drivers -----------------------------------------------------------------

/** Rejects keys that are empty, absolute or point outside the uploads tree. */
export const safeRel = (rel) => {
  const norm = path.posix.normalize(rel || '');
  if (!norm || norm === '.' || norm.startsWith('..') || path.posix.isAbsolute(norm)) return null;
  return norm;
};

const disk = {
  kind: 'disk',
  async put(rel, buffer) {
    const dir = path.join(env.UPLOAD_DIR, path.dirname(rel));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(env.UPLOAD_DIR, rel), buffer, { flag: 'wx' });
  },
  async get(rel) {
    const abs = path.resolve(env.UPLOAD_DIR, rel);
    if (!abs.startsWith(path.resolve(env.UPLOAD_DIR) + path.sep)) return null; // path traversal guard
    return fs.readFile(abs).catch(() => null);
  },
  async remove(rel) {
    const abs = path.resolve(env.UPLOAD_DIR, rel);
    if (!abs.startsWith(path.resolve(env.UPLOAD_DIR) + path.sep)) return; // path traversal guard
    await fs.unlink(abs).catch(() => {});
  },
};

const blobs = {
  kind: 'netlify-blobs',
  _store: null,
  async store() {
    if (!this._store) {
      // Inside Netlify Functions the site ID and token are injected automatically.
      const { getStore } = await import('@netlify/blobs');
      this._store = getStore('circle-uploads');
    }
    return this._store;
  },
  // Netlify Blobs accepts an ArrayBuffer, Blob or string - not a Node Buffer.
  toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
  async put(rel, buffer) {
    await (await this.store()).set(rel, this.toArrayBuffer(buffer));
  },
  async get(rel) {
    const ab = await (await this.store()).get(rel, { type: 'arrayBuffer' });
    return ab ? Buffer.from(ab) : null;
  },
  async remove(rel) {
    await (await this.store()).delete(rel).catch(() => {});
  },
};

export const uploads = env.STORAGE_DRIVER === 'netlify-blobs' ? blobs : disk;

async function store(buffer, ext) {
  const now = new Date();
  const rel = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await uploads.put(rel, buffer);
  return `${env.PUBLIC_BASE_URL}/uploads/${rel}`;
}

// Re-encode every still image: fixes orientation, strips EXIF (GPS location, camera serials), caps the
// dimensions and shrinks the file. GIFs are kept as they are so animation survives. A file that has a valid
// signature but cannot be decoded is rejected rather than stored.
const MAX_SIDE = 2048;
async function optimise(buffer, kind) {
  if (kind.ext === 'gif') return { buffer, ext: 'gif' };
  try {
    const img = sharp(buffer, { limitInputPixels: 80_000_000 }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    if (kind.ext === 'png') return { buffer: await img.png({ compressionLevel: 9, palette: true }).toBuffer(), ext: 'png' };
    if (kind.ext === 'webp') return { buffer: await img.webp({ quality: 82 }).toBuffer(), ext: 'webp' };
    return { buffer: await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), ext: 'jpg' };
  } catch {
    throw badRequest('Unsupported or corrupted image. Use JPG, PNG, GIF or WEBP.', 'BAD_IMAGE');
  }
}

export async function saveImage(file) {
  if (!file?.buffer) throw badRequest('No file received');
  const kind = detectImage(file.buffer);
  if (!kind) throw badRequest('Unsupported or corrupted image. Use JPG, PNG, GIF or WEBP.', 'BAD_IMAGE');
  await scanBuffer(file.buffer);
  const out = await optimise(file.buffer, kind);
  return store(out.buffer, out.ext);
}

export async function saveImages(files = []) {
  const urls = [];
  for (const f of files) urls.push(await saveImage(f));
  return urls;
}

export async function removeUploads(urls = []) {
  for (const url of urls) {
    if (!url || !url.includes('/uploads/')) continue;
    const rel = safeRel(url.split('/uploads/')[1]);
    if (rel) await uploads.remove(rel);
  }
}
