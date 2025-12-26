import { Firestore } from '@google-cloud/firestore';
import type { Env } from './env.js';

export function createDb(env: Env): Firestore {
  return new Firestore(env.GCP_PROJECT_ID ? { projectId: env.GCP_PROJECT_ID } : undefined);
}
