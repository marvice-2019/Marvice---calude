import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { attachSocketIo, type Realtime } from './realtime.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);

// The socket server needs Fastify's http server, and the routes need the socket: bind lazily.
let live: Realtime | null = null;
const realtime: Realtime = {
  conversation: (...a) => live?.conversation(...a),
  toUser: (...a) => live?.toUser(...a),
};
const app = await buildApp({ config, db, fetch: (url, init) => fetch(url, init), realtime });
const { realtime: socketRealtime, io } = attachSocketIo(app.server, config.JWT_SECRET, config.WEB_ORIGINS);
live = socketRealtime;

const shutdown = async () => {
  await io.close();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: config.PORT });
