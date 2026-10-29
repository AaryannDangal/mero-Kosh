import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import type { GroupRole } from '@prisma/client';

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload;
    try {
      payload = verifyToken(header.slice(7));
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, fullName: true, phone: true, tokenVersion: true } });
    if (!user) throw unauthorized('User no longer exists');
    if ((payload.ver ?? 0) !== user.tokenVersion) throw unauthorized('Session expired. Please log in again');
    const { tokenVersion: _tokenVersion, ...publicFields } = user;
    req.user = publicFields;
    next();
  } catch (e) {
    next(e);
  }
}

/** Loads the group and the caller's membership. Non-members get 404 (no information leak). */
export async function loadGroup(req: Request, _res: Response, next: NextFunction) {
  try {
    const groupId = req.params.groupId;
    const group = await prisma.group.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!group) throw notFound('Group');
    const membership = await prisma.groupMember.findFirst({ where: { groupId, userId: req.user!.id } });
    if (!membership) throw notFound('Group');
    req.group = group;
    req.membership = membership;
    next();
  } catch (e) {
    next(e);
  }
}

export const MANAGERS: GroupRole[] = ['ORGANIZER', 'CO_ORGANIZER'];

export function requireRole(...roles: GroupRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.membership || !roles.includes(req.membership.role)) return next(forbidden());
    next();
  };
}

export function isManager(req: Request): boolean {
  return !!req.membership && MANAGERS.includes(req.membership.role);
}
