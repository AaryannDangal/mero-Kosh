import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { config } from '../config';

export function asyncHandler<T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as T, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these values already exists', details: err.meta } });
    }
    if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Database CHECK constraints / triggers surface as unknown request errors
  if (/check constraint|immutable|append-only|cannot be deleted|cannot be changed/i.test(msg)) {
    return res.status(422).json({ error: { code: 'CONSTRAINT_VIOLATION', message: 'The database rejected this change because it violates a ledger rule', details: config.isProd ? undefined : msg } });
  }
  if (!config.isTest) console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: config.isProd ? 'Internal server error' : msg } });
}
