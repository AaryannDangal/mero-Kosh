import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { config } from '../config';

const passthrough: RequestHandler = (_req, _res, next) => next();

function make(max: number, message: string): RequestHandler {
  if (config.rateLimit.disabled) return passthrough;
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
  });
}

export const loginLimiter = make(config.rateLimit.loginMax, 'Too many login attempts. Please try again later.');
export const uploadLimiter = make(config.rateLimit.uploadMax, 'Too many uploads. Please try again later.');
export const apiLimiter = make(600, 'Too many requests.');
