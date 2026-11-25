import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';

/**
 * Live inbox events. Rooms:
 *   tenant:<id>:managers — owners and admins (see every conversation)
 *   user:<id>            — one person (an agent sees only what is sent here)
 */
export interface Realtime {
  /** A conversation-scoped event: managers of the tenant + the assignee, never other agents. */
  conversation(tenantId: string, assigneeId: string | null, event: string, data: unknown): void;
  toUser(userId: string, event: string, data: unknown): void;
}

export const noopRealtime: Realtime = { conversation: () => {}, toUser: () => {} };

export function attachSocketIo(server: HttpServer, jwtSecret: string, corsOrigin: string | string[] = []): { realtime: Realtime; io: Server } {
  const io = new Server(server, { cors: { origin: corsOrigin }, serveClient: false });

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string') return next(new Error('unauthorized'));
    try {
      socket.data.principal = await verifyToken(token, jwtSecret);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const p = socket.data.principal as { userId: string; tenantId: string; role: string };
    void socket.join(`user:${p.userId}`);
    if (p.role === 'owner' || p.role === 'admin') void socket.join(`tenant:${p.tenantId}:managers`);
  });

  const realtime: Realtime = {
    conversation(tenantId, assigneeId, event, data) {
      const rooms = [`tenant:${tenantId}:managers`];
      if (assigneeId) rooms.push(`user:${assigneeId}`);
      io.to(rooms).emit(event, data);   // a socket in both rooms receives it once
    },
    toUser(userId, event, data) {
      io.to(`user:${userId}`).emit(event, data);
    },
  };
  return { realtime, io };
}
