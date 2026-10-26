import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : process.env.NODE_ENV === 'test' ? [] : ['warn', 'error'],
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
