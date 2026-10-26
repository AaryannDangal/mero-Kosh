import type { Group, GroupMember, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: Pick<User, 'id' | 'email' | 'fullName' | 'phone'>;
      group?: Group;
      membership?: GroupMember;
    }
  }
}

export {};
