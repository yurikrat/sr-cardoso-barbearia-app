import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { BrandingSettings } from '@sr-cardoso/shared';

let globalBranding: BrandingSettings | null = null;
let lastFetchAt = 0;
let inflight: Promise<BrandingSettings> | null = null;
const listeners = new Set<(b: BrandingSettings) => void>();

const STALE_AFTER_MS = 30_000;

async function loadBranding(force = false) {
  const now = Date.now();
  const isStale = now - lastFetchAt > STALE_AFTER_MS;
  if (!force && globalBranding && !isStale) return globalBranding;

  if (!inflight) {
    inflight = api
      .getBranding()
      .then((data) => {
        lastFetchAt = Date.now();
        globalBranding = data;
        listeners.forEach((l) => l(data));
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

export function useBranding() {
  const [branding, setBranding] = useState<BrandingSettings | null>(globalBranding);

  useEffect(() => {
    const onChange = (b: BrandingSettings) => setBranding(b);
    listeners.add(onChange);

    loadBranding(false).catch((err) => console.error('Failed to load branding:', err));

    const onFocus = () => {
      loadBranding(true).catch(() => null);
    };

    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
      listeners.delete(onChange);
    };
  }, []);

  const refreshBranding = async () => {
    try {
      await loadBranding(true);
    } catch (err) {
      console.error('Failed to refresh branding:', err);
    }
  };

  const logoSrc = (() => {
    const url = branding?.logoUrl;
    if (!url) return '/logo.png';
    const v = branding?.updatedAt ? encodeURIComponent(branding.updatedAt) : '';
    if (!v) return url;
    return url.includes('?') ? `${url}&v=${v}` : `${url}?v=${v}`;
  })();

  return { branding, logoSrc, refreshBranding };
}
