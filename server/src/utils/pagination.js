import mongoose from 'mongoose';
import { LIMITS } from '../../../shared/constants.js';
import { badRequest } from './AppError.js';

export const clampLimit = (raw, def = LIMITS.pageSize) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, LIMITS.maxPageSize);
};

// Cursors are opaque base64 strings wrapping the last _id (time-ordered ObjectId) of a page.
export const encodeCursor = (id) => (id ? Buffer.from(String(id)).toString('base64url') : null);

export const decodeCursor = (cursor) => {
  if (!cursor) return null;
  const id = Buffer.from(String(cursor), 'base64url').toString();
  if (!mongoose.isValidObjectId(id)) throw badRequest('Invalid cursor', 'BAD_CURSOR');
  return new mongoose.Types.ObjectId(id);
};

// Runs a descending (default) _id-ordered query with limit+1 lookahead and returns {items,nextCursor}.
export async function cursorPage(model, filter, { cursor, limit, sort = -1, select, populate, lean = true } = {}) {
  const lim = clampLimit(limit);
  const after = decodeCursor(cursor);
  const q = { ...filter };
  if (after) {
    const idCond = sort === -1 ? { $lt: after } : { $gt: after };
    q._id = q._id ? { ...q._id, ...idCond } : idCond;
  }
  let query = model.find(q).sort({ _id: sort }).limit(lim + 1);
  if (select) query = query.select(select);
  if (populate) query = query.populate(populate);
  if (lean) query = query.lean();
  const rows = await query;
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]._id) : null };
}

export const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const sameId = (a, b) => String(a) === String(b);
