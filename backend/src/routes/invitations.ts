import { Router } from 'express';
import { asyncHandler } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import { actorOf } from './util';
import { acceptMemberInvitation, previewMemberInvitation } from '../services/groups';

export const invitationsRouter = Router();

invitationsRouter.get('/:token', asyncHandler(async (req, res) => {
  res.json({ invitation: await previewMemberInvitation(req.params.token) });
}));

invitationsRouter.post('/:token/accept', requireAuth, asyncHandler(async (req, res) => {
  const result = await acceptMemberInvitation(req.params.token, req.user!.id, actorOf(req));
  res.json(result);
}));
