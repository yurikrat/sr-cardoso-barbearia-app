import { createApp } from './app.js';
import { bootstrapMasterUserIfNeeded } from './lib/adminAuth.js';
import { createDb } from './lib/db.js';
import { getEnv } from './lib/env.js';

const env = getEnv();

console.log('[server] Starting up...');
console.log('[server] Environment:', {
  PORT: env.PORT,
  GCP_PROJECT_ID: env.GCP_PROJECT_ID,
  NODE_ENV: process.env.NODE_ENV,
});

const db = createDb(env);
void bootstrapMasterUserIfNeeded(db, env);

const app = createApp({ env, db });

app.listen(Number(env.PORT), '0.0.0.0', () => {
  console.log(`[server] listening on 0.0.0.0:${env.PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});


