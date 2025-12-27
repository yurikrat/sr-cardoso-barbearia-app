import { Storage } from '@google-cloud/storage';
import type { Firestore } from '@google-cloud/firestore';
import { DEFAULT_BRANDING, type BrandingSettings } from '@sr-cardoso/shared';
import type { Env } from './env.js';

export const BRANDING_CONFIG_DOC_PATH = 'settings/branding';

let brandingCache: BrandingSettings | null = null;

export async function getBrandingConfig(db: Firestore): Promise<BrandingSettings> {
  if (brandingCache) return brandingCache;

  const doc = await db.doc(BRANDING_CONFIG_DOC_PATH).get();
  if (!doc.exists) {
    return DEFAULT_BRANDING;
  }

  const data = doc.data() as Partial<BrandingSettings>;
  brandingCache = {
    ...DEFAULT_BRANDING,
    ...data,
  };
  return brandingCache;
}

export function setBrandingConfigCache(config: BrandingSettings) {
  brandingCache = config;
}

export async function uploadToGCS(
  env: Env,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<{ bucket: string; objectPath: string }> {
  if (!env.GCP_STORAGE_BUCKET) {
    throw new Error('GCP_STORAGE_BUCKET não configurado (defina no Cloud Run / ambiente)');
  }

  const storage = new Storage(env.GCP_PROJECT_ID ? { projectId: env.GCP_PROJECT_ID } : undefined);
  const bucket = storage.bucket(env.GCP_STORAGE_BUCKET);
  const objectPath = `branding/${filename}`;
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    metadata: { contentType },
  });

  return { bucket: env.GCP_STORAGE_BUCKET, objectPath };
}

export async function downloadFromGCS(
  env: Env,
  objectPath: string
): Promise<{ buffer: Buffer; contentType: string | null; etag: string | null }> {
  if (!env.GCP_STORAGE_BUCKET) {
    throw new Error('GCP_STORAGE_BUCKET não configurado (defina no Cloud Run / ambiente)');
  }

  const storage = new Storage(env.GCP_PROJECT_ID ? { projectId: env.GCP_PROJECT_ID } : undefined);
  const bucket = storage.bucket(env.GCP_STORAGE_BUCKET);
  const file = bucket.file(objectPath);

  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();

  return {
    buffer,
    contentType: (metadata as any)?.contentType ?? null,
    etag: (metadata as any)?.etag ?? null,
  };
}

export async function copyFileInGCS(
  env: Env,
  sourceFilename: string,
  destFilename: string
): Promise<void> {
  if (!env.GCP_STORAGE_BUCKET) {
    throw new Error('GCP_STORAGE_BUCKET não configurado');
  }
  const storage = new Storage(env.GCP_PROJECT_ID ? { projectId: env.GCP_PROJECT_ID } : undefined);
  const bucket = storage.bucket(env.GCP_STORAGE_BUCKET);
  const source = bucket.file(`branding/${sourceFilename}`);
  const dest = bucket.file(`branding/${destFilename}`);
  
  await source.copy(dest);
}
