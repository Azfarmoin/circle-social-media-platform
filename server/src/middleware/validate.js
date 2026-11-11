import { badRequest } from '../utils/AppError.js';

// validate({ body, query, params }) parses with zod, replaces the raw input with the cleaned
// output, and turns failures into a 400 listing every problem.
export const validate = (schemas) => (req, _res, next) => {
  const errors = [];
  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;
    const parsed = schema.safeParse(req[part] ?? {});
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => errors.push({ field: [part === 'body' ? '' : part, ...i.path].filter(Boolean).join('.'), message: i.message }));
    } else {
      req[part] = parsed.data;
    }
  }
  if (errors.length) return next(badRequest(errors[0].message, 'VALIDATION', errors));
  next();
};
