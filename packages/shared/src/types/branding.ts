export interface BrandingSettings {
  logoUrl: string | null;
  faviconUrl: string | null;
  logoAlignment: 'left' | 'center' | 'right';
  logoScale: number; // 0.5 to 2.0
  updatedAt: string;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  logoUrl: '/logo.png',
  faviconUrl: '/favicon.ico',
  logoAlignment: 'center',
  logoScale: 1.0,
  updatedAt: new Date().toISOString(),
};
