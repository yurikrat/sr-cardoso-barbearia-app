import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { BrandingSettings } from '@sr-cardoso/shared';

let globalBranding: BrandingSettings | null = null;
const listeners = new Set<(b: BrandingSettings) => void>();

export function useBranding() {
  const [branding, setBranding] = useState<BrandingSettings | null>(globalBranding);

  useEffect(() => {
    const onChange = (b: BrandingSettings) => setBranding(b);
    listeners.add(onChange);

    if (!globalBranding) {
      api.getBranding()
        .then((data) => {
          globalBranding = data;
          listeners.forEach((l) => l(data));
        })
        .catch((err) => console.error('Failed to load branding:', err));
    }

    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const refreshBranding = async () => {
    try {
      const data = await api.getBranding();
      globalBranding = data;
      listeners.forEach((l) => l(data));
    } catch (err) {
      console.error('Failed to refresh branding:', err);
    }
  };

  return { branding, refreshBranding };
}
