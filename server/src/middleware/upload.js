import multer from 'multer';
import { LIMITS } from '../../../shared/constants.js';
import { badRequest } from '../utils/AppError.js';

// Files are buffered in memory (size-capped) so their real type can be verified before anything
// touches the disk. See services/uploadService.js.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.uploadBytes, files: LIMITS.maxMedia, fields: 30, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, cb) => (ALLOWED_MIME.has(file.mimetype) ? cb(null, true) : cb(badRequest('Only JPG, PNG, GIF and WEBP images are allowed', 'BAD_IMAGE'))),
});

export const uploadImages = (field = 'images', max = LIMITS.maxMedia) => uploader.array(field, max);
export const uploadImage = (field = 'image') => uploader.single(field);
