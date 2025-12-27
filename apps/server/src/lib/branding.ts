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
): Promise<string> {
  if (!env.GCP_STORAGE_BUCKET) {
    throw new Error('GCP_STORAGE_BUCKET não configurado');
  }

  const storage = new Storage(env.GCP_PROJECT_ID ? { projectId: env.GCP_PROJECT_ID } : undefined);
  const bucket = storage.bucket(env.GCP_STORAGE_BUCKET);
  const file = bucket.file(`branding/${filename}`);

  await file.save(buffer, {
    metadata: { contentType },
    public: true,
  });

  // Retorna a URL pública (assumindo que o bucket/objeto é público)
  return `https://storage.googleapis.com/${env.GCP_STORAGE_BUCKET}/branding/${filename}`;
}
