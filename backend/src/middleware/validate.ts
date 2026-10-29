import type { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { AppError } from '../lib/errors';

type Part = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) return next(zodToAppError(result.error));
    // query is a getter in Express 5; in 4 we can assign
    (req as unknown as Record<Part, unknown>)[part] = result.data;
    next();
  };
}

export function zodToAppError(err: ZodError): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Invalid input', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
}

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw zodToAppError(r.error);
  return r.data;
}
