import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Firestore } from '@google-cloud/firestore';

import type { Env } from './lib/env.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerPublicRoutes } from './routes/public.js';

export type CreateAppDeps = {
  env: Env;
  db: Firestore;
};

export function createApp(deps: CreateAppDeps) {
  const { env, db } = deps;

  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN ? [env.WEB_ORIGIN] : true,
      credentials: false,
    })
  );
  app.use(express.json({ limit: '1mb' }));

  registerPublicRoutes(app, { env, db });
  registerAdminRoutes(app, { env, db });

  // Optional: serve static build (Cloud Run single-service mode)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const defaultStaticDir = path.resolve(__dirname, '../../web/dist');
  const staticDir = env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : defaultStaticDir;

  app.use(express.static(staticDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  return app;
}
