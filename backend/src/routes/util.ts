import type { Request } from 'express';
import type { Actor } from '../services/rounds';

export const actorOf = (req: Request): Actor => ({ userId: req.user!.id, ip: req.ip ?? null });
