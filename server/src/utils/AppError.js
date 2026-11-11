export class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, code, details) => new AppError(400, msg, code, details);
export const unauthorized = (msg = 'Authentication required', code = 'UNAUTHORIZED') => new AppError(401, msg, code);
export const forbidden = (msg = 'You do not have permission to do that', code = 'FORBIDDEN') => new AppError(403, msg, code);
export const notFound = (msg = 'Not found', code = 'NOT_FOUND') => new AppError(404, msg, code);
export const conflict = (msg, code = 'CONFLICT') => new AppError(409, msg, code);
export const tooMany = (msg = 'Too many requests', code = 'RATE_LIMITED') => new AppError(429, msg, code);
