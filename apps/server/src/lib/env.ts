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

  // Evolution API (WhatsApp)
  EVOLUTION_BASE_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_INSTANCE_NAME?: string;

  // Cron jobs
  CRON_SECRET?: string;
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

    EVOLUTION_BASE_URL: process.env.EVOLUTION_BASE_URL,
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
    EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME,

    CRON_SECRET: process.env.CRON_SECRET,
  };
}
