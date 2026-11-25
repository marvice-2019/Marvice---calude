import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type Role = 'owner' | 'admin' | 'agent';

export interface Principal {
  userId: string;
  tenantId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

const ISSUER = 'wa-crm';
const TOKEN_TTL = '12h';

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export async function signToken(p: Principal, secret: string): Promise<string> {
  return new SignJWT({ tid: p.tenantId, role: p.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyToken(token: string, secret: string): Promise<Principal> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: ISSUER,
    algorithms: ['HS256'],
  });
  const role = payload.role;
  if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string' ||
      (role !== 'owner' && role !== 'admin' && role !== 'agent')) {
    throw new Error('malformed token');
  }
  return { userId: payload.sub, tenantId: payload.tid, role };
}

/** preHandler: rejects requests without a valid Bearer token. */
export function requireAuth(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'missing_token' });
    try {
      req.principal = await verifyToken(header.slice(7), secret);
    } catch {
      return reply.code(401).send({ error: 'invalid_token' });
    }
  };
}

/** preHandler: allows only the listed roles. Run after requireAuth. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.principal || !roles.includes(req.principal.role)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}
