import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.isTest ? 4 : BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface JwtPayload {
  sub: string;
  email?: string;
  ver?: number;
}

export function signToken(user: { id: string; email: string | null; tokenVersion: number }): string {
  return jwt.sign({ sub: user.id, ver: user.tokenVersion, ...(user.email ? { email: user.email } : {}) } satisfies JwtPayload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    issuer: 'dhukuti-manager',
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret, { issuer: 'dhukuti-manager' }) as JwtPayload;
}
