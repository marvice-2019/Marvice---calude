import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = await buildApp({ config, db, fetch: (url, init) => fetch(url, init) });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: config.PORT });
