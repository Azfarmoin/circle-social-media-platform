import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const notFoundHandler = (req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.path}`, code: 'ROUTE_NOT_FOUND' });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ message: err.message, code: err.code, ...(err.details ? { errors: err.details } : {}) });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large (max 5 MB)' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Too many files' : 'Upload failed';
    return res.status(400).json({ message, code: err.code });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body', code: 'BAD_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body too large', code: 'TOO_LARGE' });
  if (err.code === 11000) return res.status(409).json({ message: 'That value is already in use', code: 'DUPLICATE' });
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid identifier', code: 'BAD_ID' });
  if (err.name === 'ValidationError') return res.status(400).json({ message: Object.values(err.errors)[0]?.message || 'Invalid data', code: 'VALIDATION' });

  logger.error({ err, reqId: req.id, path: req.path }, 'unhandled error');
  res.status(500).json({ message: 'Something went wrong on our side', code: 'INTERNAL', requestId: req.id, ...(env.isProd ? {} : { detail: err.message }) });
};
