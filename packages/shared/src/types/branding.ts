export interface BrandingSettings {
  logoUrl: string | null;
  updatedAt: string;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  logoUrl: '/logo.png',
  updatedAt: new Date().toISOString(),
};
