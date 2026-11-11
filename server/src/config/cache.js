// Small cache abstraction. Uses Redis when REDIS_URL is set, otherwise an in-process TTL map.
// Both expose the same async API so services never care which one is active.
import { env } from './env.js';
import { logger } from './logger.js';

class MemoryCache {
  constructor() {
    this.store = new Map();
    this.kind = 'memory';
  }
  async get(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.exp < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }
  async set(key, value, ttlSec = 30) {
    this.store.set(key, { value, exp: Date.now() + ttlSec * 1000 });
    if (this.store.size > 10000) this.sweep();
  }
  async del(...keys) {
    keys.flat().forEach((k) => this.store.delete(k));
  }
  sweep() {
    const now = Date.now();
    for (const [k, v] of this.store) if (v.exp < now) this.store.delete(k);
  }
  async close() {
    this.store.clear();
  }
}

class RedisCache {
  constructor(client) {
    this.client = client;
    this.kind = 'redis';
  }
  async get(key) {
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  async set(key, value, ttlSec = 30) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
  }
  async del(...keys) {
    const flat = keys.flat();
    if (flat.length) await this.client.del(...flat);
  }
  async close() {
    await this.client.quit();
  }
}

async function build() {
  if (!env.REDIS_URL) return new MemoryCache();
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    await client.connect();
    logger.info('Redis cache connected');
    return new RedisCache(client);
  } catch (err) {
    logger.warn({ err: err.message }, 'Redis unavailable, falling back to in-memory cache');
    return new MemoryCache();
  }
}

export const cache = await build();
