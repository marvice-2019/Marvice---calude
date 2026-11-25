import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withPlatform, type Db } from './db.js';

export type Role = 'owner' | 'admin' | 'agent';

export interface Principal {
  userId: string;
  tenantId: string;
  role: Role;
  /** Set when a platform admin is acting as this tenant (support); the admin's user id. */
  impersonatedBy?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    platformAdmin?: { userId: string };
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
      (role !== 'owner' && role !== 'admin' && role !== 'agent') ||
      payload.scope !== undefined || (payload.imp !== undefined && typeof payload.imp !== 'string')) {
    throw new Error('malformed token'); // a scoped (platform-admin) token is never a tenant token
  }
  return { userId: payload.sub, tenantId: payload.tid, role,
    ...(typeof payload.imp === 'string' ? { impersonatedBy: payload.imp } : {}) };
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

// ---------- Platform admin (super-admin) ----------

const IMPERSONATION_TTL = '15m';

/** Platform-admin token: `scope: 'platform'`, no tenant. verifyToken rejects it. */
export async function signPlatformToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ scope: 'platform' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(new TextEncoder().encode(secret));
}

/** Short-lived tenant token for a platform admin acting as `p`; `imp` names the admin. */
export async function signImpersonationToken(p: Principal, adminUserId: string, secret: string): Promise<string> {
  return new SignJWT({ tid: p.tenantId, role: p.role, imp: adminUserId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(IMPERSONATION_TTL)
    .sign(new TextEncoder().encode(secret));
}

/** preHandler: a platform-admin token whose user is still a platform admin. */
export function requirePlatformAdmin(secret: string, db: Db) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'missing_token' });
    let userId: string;
    try {
      const { payload } = await jwtVerify(header.slice(7), new TextEncoder().encode(secret), {
        issuer: ISSUER,
        algorithms: ['HS256'],
      });
      if (payload.scope !== 'platform') throw new Error('not a platform token');
      if (typeof payload.sub !== 'string') throw new Error('malformed token');
      userId = payload.sub;
    } catch {
      return reply.code(401).send({ error: 'invalid_token' });
    }
    // Checked per request, so demoting an admin takes effect at once.
    const ok = await withPlatform(db, (tx) =>
      tx.query('SELECT 1 FROM users WHERE id = $1 AND is_platform_admin', [userId]));
    if (!ok.rowCount) return reply.code(403).send({ error: 'forbidden' });
    req.platformAdmin = { userId };
  };
}
