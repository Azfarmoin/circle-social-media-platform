import { z } from 'zod';
import { cleanText } from '../utils/text.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const text = (max, { min = 0 } = {}) =>
  z.string().max(max * 2).transform(cleanText).pipe(z.string().min(min).max(max));

export const cursorQuery = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

// Multipart form fields arrive as strings; accept either real JSON values or JSON-encoded strings.
export const json = (schema) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);

export const idParam = z.object({ id: objectId });

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');
