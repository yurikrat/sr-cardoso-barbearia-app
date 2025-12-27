export type Env = {
  PORT: string;
  GCP_PROJECT_ID?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_JWT_SECRET?: string;
  WEB_ORIGIN?: string;
  STATIC_DIR?: string;
  CANCEL_LINK_PEPPER?: string;
  GCP_STORAGE_BUCKET?: string;
};

export function getEnv(): Env {
  return {
    PORT: process.env.PORT ?? '8080',
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    STATIC_DIR: process.env.STATIC_DIR,
    CANCEL_LINK_PEPPER: process.env.CANCEL_LINK_PEPPER,
    GCP_STORAGE_BUCKET: process.env.GCP_STORAGE_BUCKET,
  };
}
